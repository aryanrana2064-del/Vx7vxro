import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createRemoteSite, listRemoteSites, RemoteError, remoteStatus } from "../lib/remote";
import { recordAudit } from "../lib/security";
import { clientIp, getAuth, requireSession } from "../middleware/auth";

/**
 * Server-side proxy to the deployed VXQOR Worker (production vxqor-db registry).
 * The remote API token is attached here only; responses never include it.
 */
export const remoteSiteRoutes = new Hono<{ Bindings: AppEnv; Variables: { config: import("../env").AppConfig; auth?: import("../middleware/auth").AuthContext } }>();

remoteSiteRoutes.get("/remote/status", requireSession, async (c) => {
  const status = await remoteStatus(c.get("config"));
  return c.json(status);
});

remoteSiteRoutes.get("/remote/websites", requireSession, async (c) => {
  try {
    const sites = await listRemoteSites(c.get("config"));
    return c.json({ sites, source: "remote" });
  } catch (err) {
    if (err instanceof RemoteError) return c.json({ error: err.reason }, err.status);
    throw err;
  }
});

remoteSiteRoutes.post("/remote/websites", requireSession, async (c) => {
  const auth = getAuth(c);
  const raw = (await c.req.json().catch(() => null)) as { name?: unknown; environment?: unknown; domains?: unknown } | null;
  const name = typeof raw?.name === "string" ? raw.name.trim() : "";
  const environment = typeof raw?.environment === "string" ? raw.environment : "production";
  const domains = Array.isArray(raw?.domains) ? (raw.domains as unknown[]).map(String).filter(Boolean) : [];
  if (!name || domains.length === 0) return c.json({ error: "name and domains are required" }, 400);
  try {
    const site = await createRemoteSite(c.get("config"), { name, environment, domains });
    await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "sites", action: "remote_site_created", actor: auth.ownerEmail, ip: clientIp(c), meta: { remoteId: site.id, domains } });
    return c.json({ site, source: "remote" }, 201);
  } catch (err) {
    if (err instanceof RemoteError) return c.json({ error: err.reason }, err.status);
    throw err;
  }
});
