import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createDeploymentSchema } from "@vxqor/shared";
import { newId } from "../lib/ids";
import { recordAudit } from "../lib/security";
import { nowIso } from "../lib/time";
import { clientIp, getAuth, requireScope } from "../middleware/auth";

export const deploymentRoutes = new Hono<{ Bindings: AppEnv; Variables: { auth?: import("../middleware/auth").AuthContext } }>();

deploymentRoutes.get("/deployments", requireScope("deployments:read"), async (c) => {
  const siteId = c.req.query("siteId");
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const rows = siteId
    ? await c.env.DB.prepare("SELECT * FROM deployments WHERE site_id = ? ORDER BY created_at DESC LIMIT ?").bind(siteId, limit).all()
    : await c.env.DB.prepare("SELECT * FROM deployments ORDER BY created_at DESC LIMIT ?").bind(limit).all();
  return c.json({ deployments: rows.results });
});

deploymentRoutes.post("/deployments", requireScope("deployments:write"), async (c) => {
  const auth = getAuth(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = createDeploymentSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid_request" }, 400);
  const d = parsed.data;
  const now = nowIso();
  const id = newId("dep");
  const providerRef = d.commitSha ? `${d.source}:${d.commitSha}` : null;
  if (providerRef) {
    const existing = await c.env.DB.prepare("SELECT id FROM deployments WHERE provider_ref = ?").bind(providerRef).first<{ id: string }>();
    if (existing) return c.json({ deployment: { id: existing.id, deduplicated: true } }, 200);
  }
  await c.env.DB
    .prepare("INSERT INTO deployments (id, site_id, source, environment, status, commit_sha, commit_message, branch, url, error_summary, provider_ref, created_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, d.siteId ?? null, d.source, d.environment, d.status, d.commitSha ?? null, d.commitMessage ?? null, d.branch ?? null, d.url ?? null, d.errorSummary ?? null, providerRef, now, d.status === "ready" || d.status === "error" ? now : null)
    .run();
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "deployments", action: "deployment_recorded", actor: auth.ownerEmail, ip: clientIp(c), meta: { deploymentId: id, source: d.source, commit: d.commitSha } });
  return c.json({ deployment: { id } }, 201);
});
