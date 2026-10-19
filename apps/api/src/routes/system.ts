import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { AppConfig } from "../env";
import { resolveSession } from "../middleware/auth";

export const systemRoutes = new Hono<{ Bindings: AppEnv; Variables: { config: AppConfig } }>();

systemRoutes.get("/health", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1 AS ok").first();
    return c.json({ status: "ok", service: "vxqor-api", version: "0.1.0" });
  } catch (err) {
    return c.json({ status: "error", service: "vxqor-api", detail: "database_unreachable" }, 503);
  }
});

systemRoutes.get("/system/state", async (c) => {
  const cfg: AppConfig = c.get("config");
  const ownerCount = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM owners").first<{ n: number }>();
  const auth = await resolveSession(c);
  const heartbeat = await c.env.DB
    .prepare("SELECT last_run_at, last_success_at FROM scheduler_heartbeats WHERE job = 'monitor'")
    .first<{ last_run_at: string | null; last_success_at: string | null }>();
  const stale =
    !heartbeat?.last_success_at || Date.now() - new Date(heartbeat.last_success_at).getTime() > 20 * 60_000;
  const ownerRow = auth
    ? await c.env.DB.prepare("SELECT id, email, created_at, totp_enabled_at FROM owners WHERE id = ?").bind(auth.ownerId).first<{
        id: string;
        email: string;
        created_at: string;
        totp_enabled_at: string | null;
      }>()
    : null;
  return c.json({
    bootstrapRequired: (ownerCount?.n ?? 0) === 0,
    authenticated: Boolean(auth),
    owner: ownerRow
      ? { id: ownerRow.id, email: ownerRow.email, createdAt: ownerRow.created_at, mfaEnabled: Boolean(ownerRow.totp_enabled_at) }
      : null,
    runtime: cfg.runtime,
    version: "0.1.0",
    encryptionConfigured: cfg.encryptionKey !== null,
    scheduler: {
      lastRunAt: heartbeat?.last_run_at ?? null,
      lastSuccessAt: heartbeat?.last_success_at ?? null,
      stale,
    },
  });
});
