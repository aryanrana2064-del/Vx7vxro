import { Hono } from "hono";
import type { AppEnv } from "../env";
import { alertConfigSchema, integrationConfigSchema } from "@vxqor/shared";
import type { IntegrationKind } from "@vxqor/shared";
import { decryptJson, encryptJson, hmacSha256Hex } from "../lib/crypto";
import { newId } from "../lib/ids";
import { log } from "../lib/log";
import { sendAlert } from "../lib/notify";
import { recordAudit } from "../lib/security";
import { nowIso } from "../lib/time";
import { clientIp, getAuth, requireSession } from "../middleware/auth";

export const integrationRoutes = new Hono<{ Bindings: AppEnv; Variables: { auth?: import("../middleware/auth").AuthContext; config: import("../env").AppConfig } }>();

interface StoredConfig {
  kind: IntegrationKind;
  token: string;
  repo?: string;
  branch?: string;
  projectId?: string;
  teamId?: string;
}

async function getIntegration(db: D1Database, kind: IntegrationKind, key: Uint8Array | null) {
  const row = await db.prepare("SELECT * FROM integrations WHERE kind = ?").bind(kind).first<import("@vxqor/shared").IntegrationRow>();
  if (!row) return null;
  if (!key) return { row, config: null as StoredConfig | null };
  try {
    const config = await decryptJson<StoredConfig>(row.config_enc, key);
    return { row, config };
  } catch {
    return { row, config: null as StoredConfig | null };
  }
}

integrationRoutes.get("/integrations", requireSession, async (c) => {
  const cfg = c.get("config");
  const rows = await c.env.DB.prepare("SELECT kind, status, last_sync_at, last_error, updated_at FROM integrations").all();
  const alert = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('alert_webhook_url','alert_webhook_secret')").all<{ key: string; value: string }>();
  const alertSettings = Object.fromEntries(alert.results.map((r) => [r.key, r.value]));
  return c.json({
    encryptionConfigured: cfg.encryptionKey !== null,
    integrations: rows.results,
    alerts: {
      webhookConfigured: Boolean(alertSettings["alert_webhook_url"]),
      secretConfigured: Boolean(alertSettings["alert_webhook_secret"]),
    },
  });
});

integrationRoutes.put("/integrations/:kind", requireSession, async (c) => {
  const cfg = c.get("config");
  const auth = getAuth(c);
  const kind = c.req.param("kind");
  const raw = await c.req.json().catch(() => null);
  const parsed = integrationConfigSchema.safeParse(raw);
  if (!parsed.success || parsed.data.kind !== kind) return c.json({ error: "invalid_config" }, 400);
  if (!cfg.encryptionKey) return c.json({ error: "encryption_not_configured", hint: "set VXQOR_ENCRYPTION_KEY on the API" }, 409);

  // Validate credentials before storing.
  let status: "connected" | "error" = "connected";
  let lastError: string | null = null;
  if (parsed.data.kind === "github") {
    try {
      const res = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${parsed.data.token}`, accept: "application/vnd.github+json", "user-agent": "vxqor" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        status = "error";
        lastError = `github_auth_http_${res.status}`;
      }
    } catch (err) {
      status = "error";
      lastError = "github_unreachable";
      log("warn", "github_validation_failed", { message: String((err as Error).message) });
    }
  } else {
    try {
      const res = await fetch("https://api.vercel.com/v2/user", { headers: { authorization: `Bearer ${parsed.data.token}` }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        status = "error";
        lastError = `vercel_auth_http_${res.status}`;
      }
    } catch {
      status = "error";
      lastError = "vercel_unreachable";
    }
  }

  const enc = await encryptJson(parsed.data, cfg.encryptionKey);
  const now = nowIso();
  const existing = await c.env.DB.prepare("SELECT id FROM integrations WHERE kind = ?").bind(kind).first<{ id: string }>();
  if (existing) {
    await c.env.DB.prepare("UPDATE integrations SET config_enc = ?, status = ?, last_error = ?, updated_at = ? WHERE kind = ?").bind(enc, status, lastError, now, kind).run();
  } else {
    await c.env.DB.prepare("INSERT INTO integrations (id, kind, config_enc, status, last_error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(newId("int"), kind, enc, status, lastError, now, now).run();
  }
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "integrations", action: "integration_configured", actor: auth.ownerEmail, ip: clientIp(c), meta: { kind, status } });
  return c.json({ kind, status, lastError });
});

integrationRoutes.delete("/integrations/:kind", requireSession, async (c) => {
  const auth = getAuth(c);
  const kind = c.req.param("kind");
  await c.env.DB.prepare("DELETE FROM integrations WHERE kind = ?").bind(kind).run();
  await c.env.DB.prepare("DELETE FROM integration_cache WHERE kind = ?").bind(kind).run();
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "integrations", action: "integration_removed", actor: auth.ownerEmail, ip: clientIp(c), meta: { kind } });
  return c.json({ ok: true });
});

integrationRoutes.post("/integrations/:kind/sync", requireSession, async (c) => {
  const cfg = c.get("config");
  const kind = c.req.param("kind") as IntegrationKind;
  if (!cfg.encryptionKey) return c.json({ error: "encryption_not_configured" }, 409);
  const integration = await getIntegration(c.env.DB, kind, cfg.encryptionKey);
  if (!integration?.config) return c.json({ error: "not_configured" }, 404);
  const config = integration.config;
  const now = nowIso();

  if (kind === "github") {
    const headers = { authorization: `Bearer ${config.token}`, accept: "application/vnd.github+json", "user-agent": "vxqor" };
    const base = `https://api.github.com/repos/${config.repo}`;
    const [commits, pulls, releases] = await Promise.all([
      fetch(`${base}/commits?sha=${encodeURIComponent(config.branch ?? "main")}&per_page=30`, { headers, signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http_${r.status}`)))).catch(() => null),
      fetch(`${base}/pulls?state=all&per_page=20&sort=updated&direction=desc`, { headers, signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http_${r.status}`)))).catch(() => null),
      fetch(`${base}/releases?per_page=10`, { headers, signal: AbortSignal.timeout(10000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http_${r.status}`)))).catch(() => null),
    ]);
    if (!commits) {
      await c.env.DB.prepare("UPDATE integrations SET status = 'error', last_error = 'github_fetch_failed', last_sync_at = ?, updated_at = ? WHERE kind = 'github'").bind(now, now).run();
      return c.json({ error: "sync_failed", detail: "github_fetch_failed (rate limit or revoked token)" }, 502);
    }
    const payload = { commits, pulls, releases, repo: config.repo, branch: config.branch };
    await c.env.DB.prepare("INSERT OR REPLACE INTO integration_cache (kind, payload, fetched_at) VALUES ('github', ?, ?)").bind(JSON.stringify(payload), now).run();
    await c.env.DB.prepare("UPDATE integrations SET status = 'connected', last_error = NULL, last_sync_at = ?, updated_at = ? WHERE kind = 'github'").bind(now, now).run();
    return c.json({ syncedAt: now, commits: Array.isArray(commits) ? commits.length : 0 });
  }

  // Vercel: pull deployments into the deployments table.
  const teamParam = config.teamId ? `&teamId=${encodeURIComponent(config.teamId)}` : "";
  const res = await fetch(`https://api.vercel.com/v6/deployments?limit=30${config.projectId ? `&projectId=${encodeURIComponent(config.projectId)}` : ""}${teamParam}`, { headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    await c.env.DB.prepare("UPDATE integrations SET status = 'error', last_error = ?, last_sync_at = ?, updated_at = ? WHERE kind = 'vercel'").bind(`vercel_http_${res.status}`, now, now).run();
    return c.json({ error: "sync_failed", detail: `vercel_http_${res.status}` }, 502);
  }
  const body = (await res.json()) as { deployments?: { uid: string; name?: string; target?: string; state?: string; meta?: { commitSha?: string; commitMessage?: string; branch?: string }; url?: string; created?: number; ready?: number }[] };
  let upserted = 0;
  for (const d of body.deployments ?? []) {
    const statusMap: Record<string, string> = { READY: "ready", ERROR: "error", CANCELED: "canceled", QUEUED: "queued", BUILDING: "building" };
    const existing = await c.env.DB.prepare("SELECT id FROM deployments WHERE provider_ref = ?").bind(`vercel:${d.uid}`).first();
    if (existing) continue;
    await c.env.DB
      .prepare("INSERT INTO deployments (id, site_id, source, environment, status, commit_sha, commit_message, branch, url, provider_ref, created_at, finished_at) VALUES (?, NULL, 'vercel', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(newId("dep"), d.target === "production" ? "production" : "preview", statusMap[d.state ?? ""] ?? "queued", d.meta?.commitSha ?? null, d.meta?.commitMessage ?? null, d.meta?.branch ?? null, d.url ? `https://${d.url}` : null, `vercel:${d.uid}`, new Date(d.created ?? Date.now()).toISOString(), d.ready ? new Date(d.ready).toISOString() : null)
      .run();
    upserted += 1;
  }
  await c.env.DB.prepare("UPDATE integrations SET status = 'connected', last_error = NULL, last_sync_at = ?, updated_at = ? WHERE kind = 'vercel'").bind(now, now).run();
  return c.json({ syncedAt: now, newDeployments: upserted });
});

integrationRoutes.get("/integrations/github/data", requireSession, async (c) => {
  const row = await c.env.DB.prepare("SELECT status, last_sync_at, last_error FROM integrations WHERE kind = 'github'").first<{ status: string; last_sync_at: string | null; last_error: string | null }>();
  if (!row) return c.json({ configured: false });
  const cache = await c.env.DB.prepare("SELECT payload, fetched_at FROM integration_cache WHERE kind = 'github'").first<{ payload: string; fetched_at: string }>();
  if (!cache) return c.json({ configured: true, status: row.status, lastSyncAt: row.last_sync_at, lastError: row.last_error, data: null });
  const payload = JSON.parse(cache.payload) as {
    commits: { sha: string; commit: { message: string; author: { name: string; date: string } }; html_url: string }[];
    pulls: { number: number; title: string; state: string; html_url: string; user: { login: string } | null; updated_at: string }[];
    releases: { tag_name: string; name: string; published_at: string; html_url: string }[];
    repo: string;
    branch: string | undefined;
  };
  return c.json({
    configured: true,
    status: row.status,
    lastSyncAt: cache.fetched_at,
    lastError: row.last_error,
    data: {
      repo: payload.repo,
      branch: payload.branch,
      commits: (payload.commits ?? []).map((cm) => ({ sha: cm.sha, message: cm.commit?.message?.slice(0, 300) ?? "", author: cm.commit?.author?.name ?? "unknown", date: cm.commit?.author?.date ?? "", url: cm.html_url })),
      pulls: (payload.pulls ?? []).map((p) => ({ number: p.number, title: p.title, state: p.state, author: p.user?.login ?? "unknown", updatedAt: p.updated_at, url: p.html_url })),
      releases: (payload.releases ?? []).map((r) => ({ tag: r.tag_name, name: r.name, publishedAt: r.published_at, url: r.html_url })),
    },
  });
});

integrationRoutes.get("/integrations/alerts", requireSession, async (c) => {
  const rows = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('alert_webhook_url','alert_webhook_secret')").all<{ key: string; value: string }>();
  const settings = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));
  return c.json({ webhookConfigured: Boolean(settings["alert_webhook_url"]), webhookUrl: settings["alert_webhook_url"] ?? "", secretConfigured: Boolean(settings["alert_webhook_secret"]) });
});

integrationRoutes.put("/integrations/alerts", requireSession, async (c) => {
  const auth = getAuth(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = alertConfigSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid_config" }, 400);
  const now = nowIso();
  await c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('alert_webhook_url', ?, ?)").bind(parsed.data.webhookUrl, now).run();
  if (parsed.data.webhookSecret !== undefined) {
    if (parsed.data.webhookSecret === "") await c.env.DB.prepare("DELETE FROM settings WHERE key = 'alert_webhook_secret'").run();
    else await c.env.DB.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('alert_webhook_secret', ?, ?)").bind(parsed.data.webhookSecret, now).run();
  }
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "integrations", action: "alert_config_updated", actor: auth.ownerEmail, ip: clientIp(c) });
  return c.json({ ok: true });
});

integrationRoutes.post("/integrations/alerts/test", requireSession, async (c) => {
  const result = await sendAlert(c.env.DB, { type: "test", title: "VXQOR alert test", detail: "If you see this, alert delivery works." });
  return c.json(result, result.delivered ? 200 : 409);
});

export const _hmac = hmacSha256Hex;
