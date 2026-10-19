import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createSiteSchema, updateSiteSchema } from "@vxqor/shared";
import { newId, randomToken } from "../lib/ids";
import { recordAudit } from "../lib/security";
import { nowIso } from "../lib/time";
import { clientIp, getAuth, requireScope, requireSession } from "../middleware/auth";

export const siteRoutes = new Hono<{ Bindings: AppEnv; Variables: { auth?: import("../middleware/auth").AuthContext; config: import("../env").AppConfig } }>();

siteRoutes.get("/sites", requireScope("sites:read"), async (c) => {
  const rows = await c.env.DB
    .prepare("SELECT * FROM sites ORDER BY created_at DESC LIMIT 200")
    .all<import("@vxqor/shared").SiteRow>();
  const domains = await c.env.DB.prepare("SELECT site_id, domain FROM site_domains").all<{ site_id: string; domain: string }>();
  const bySite = new Map<string, string[]>();
  for (const d of domains.results) {
    const list = bySite.get(d.site_id) ?? [];
    list.push(d.domain);
    bySite.set(d.site_id, list);
  }
  return c.json({
    sites: rows.results.map((s) => ({
      id: s.id,
      name: s.name,
      environment: s.environment,
      trackingId: s.tracking_id,
      domains: bySite.get(s.id) ?? [],
      disabled: Boolean(s.disabled_at),
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    })),
  });
});

siteRoutes.post("/sites", requireSession, async (c) => {
  const auth = getAuth(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = createSiteSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid_request" }, 400);
  const data = parsed.data;
  const domains = [...new Set(data.domains.map((d) => d.toLowerCase()))];
  const existing = await c.env.DB
    .prepare("SELECT sd.domain, s.name FROM site_domains sd JOIN sites s ON s.id = sd.site_id WHERE sd.domain IN (" + domains.map(() => "?").join(",") + ")")
    .bind(...domains)
    .all<{ domain: string; name: string }>();
  if (existing.results.length > 0) {
    return c.json({ error: `domain_already_registered`, detail: existing.results[0] }, 409);
  }
  const id = newId("site");
  const trackingId = `vxq-${randomToken(12)}`;
  const now = nowIso();
  await c.env.DB
    .prepare("INSERT INTO sites (id, name, environment, tracking_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, data.name, data.environment, trackingId, now, now)
    .run();
  for (const domain of domains) {
    await c.env.DB.prepare("INSERT INTO site_domains (id, site_id, domain) VALUES (?, ?, ?)").bind(newId("dom"), id, domain).run();
  }
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "sites", action: "site_created", actor: auth.ownerEmail, ip: clientIp(c), userAgent: c.req.header("user-agent"), meta: { siteId: id, domains } });
  return c.json({ site: { id, name: data.name, environment: data.environment, trackingId, domains, disabled: false, createdAt: now, updatedAt: now } }, 201);
});

siteRoutes.get("/sites/:id", requireScope("sites:read"), async (c) => {
  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(c.req.param("id")).first<import("@vxqor/shared").SiteRow>();
  if (!site) return c.json({ error: "not_found" }, 404);
  const domains = await c.env.DB.prepare("SELECT domain FROM site_domains WHERE site_id = ?").bind(site.id).all<{ domain: string }>();
  const monitors = await c.env.DB.prepare("SELECT id, url, status, enabled, last_check_at, interval_seconds FROM monitors WHERE site_id = ? ORDER BY created_at DESC").bind(site.id).all();
  const incidents = await c.env.DB.prepare("SELECT id, status, trigger_condition, detected_at, resolved_at FROM incidents WHERE site_id = ? ORDER BY detected_at DESC LIMIT 50").bind(site.id).all();
  const deployments = await c.env.DB.prepare("SELECT id, source, environment, status, commit_sha, commit_message, branch, url, created_at FROM deployments WHERE site_id = ? ORDER BY created_at DESC LIMIT 50").bind(site.id).all();
  return c.json({
    site: {
      id: site.id,
      name: site.name,
      environment: site.environment,
      trackingId: site.tracking_id,
      domains: domains.results.map((d) => d.domain),
      disabled: Boolean(site.disabled_at),
      createdAt: site.created_at,
      updatedAt: site.updated_at,
    },
    monitors: monitors.results,
    incidents: incidents.results,
    deployments: deployments.results,
  });
});

siteRoutes.patch("/sites/:id", requireSession, async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const site = await c.env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first<import("@vxqor/shared").SiteRow>();
  if (!site) return c.json({ error: "not_found" }, 404);
  const raw = await c.req.json().catch(() => null);
  const parsed = updateSiteSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid_request" }, 400);
  const data = parsed.data;
  const now = nowIso();
  if (data.name !== undefined) await c.env.DB.prepare("UPDATE sites SET name = ?, updated_at = ? WHERE id = ?").bind(data.name, now, id).run();
  if (data.environment !== undefined) await c.env.DB.prepare("UPDATE sites SET environment = ?, updated_at = ? WHERE id = ?").bind(data.environment, now, id).run();
  if (data.disabled !== undefined) {
    await c.env.DB.prepare("UPDATE sites SET disabled_at = ?, updated_at = ? WHERE id = ?").bind(data.disabled ? now : null, now, id).run();
    if (data.disabled) await c.env.DB.prepare("UPDATE monitors SET enabled = 0, updated_at = ? WHERE site_id = ?").bind(now, id).run();
  }
  if (data.domains) {
    const domains = [...new Set(data.domains.map((d) => d.toLowerCase()))];
    const conflicts = await c.env.DB
      .prepare("SELECT domain FROM site_domains WHERE domain IN (" + domains.map(() => "?").join(",") + ") AND site_id <> ?")
      .bind(...domains, id)
      .all<{ domain: string }>();
    if (conflicts.results.length > 0) return c.json({ error: "domain_already_registered", detail: conflicts.results[0] }, 409);
    await c.env.DB.prepare("DELETE FROM site_domains WHERE site_id = ?").bind(id).run();
    for (const domain of domains) {
      await c.env.DB.prepare("INSERT INTO site_domains (id, site_id, domain) VALUES (?, ?, ?)").bind(newId("dom"), id, domain).run();
    }
  }
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "sites", action: "site_updated", actor: auth.ownerEmail, ip: clientIp(c), userAgent: c.req.header("user-agent"), meta: { siteId: id, changes: Object.keys(data) } });
  return c.json({ ok: true });
});

siteRoutes.delete("/sites/:id", requireSession, async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const confirm = c.req.query("confirm");
  if (confirm !== id) return c.json({ error: "confirmation_required", hint: "pass ?confirm=<siteId>" }, 400);
  const site = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ?").bind(id).first<{ id: string }>();
  if (!site) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id).run();
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "sites", action: "site_deleted", actor: auth.ownerEmail, ip: clientIp(c), userAgent: c.req.header("user-agent"), meta: { siteId: id } });
  return c.json({ ok: true });
});

siteRoutes.get("/sites/:id/snippet", requireScope("sites:read"), async (c) => {
  const site = await c.env.DB.prepare("SELECT tracking_id FROM sites WHERE id = ?").bind(c.req.param("id")).first<{ tracking_id: string }>();
  if (!site) return c.json({ error: "not_found" }, 404);
  const apiBase = new URL(c.req.url).origin;
  const snippet = `<script async src="${apiBase}/v1/snippet/${site.tracking_id}.js" data-vxqor="${site.tracking_id}"></script>`;
  return c.json({ trackingId: site.tracking_id, snippet, scriptUrl: `${apiBase}/v1/snippet/${site.tracking_id}.js` });
});
