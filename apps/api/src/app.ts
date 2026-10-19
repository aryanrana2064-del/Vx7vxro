import { Hono } from "hono";
import { loadConfig, type AppEnv } from "./env";
import { runScheduler } from "./jobs/scheduler";
import { log } from "./lib/log";
import { originGuard } from "./middleware/auth";
import { analyticsRoutes } from "./routes/analytics";
import { authRoutes } from "./routes/auth";
import { collectRoutes } from "./routes/collect";
import { deploymentRoutes } from "./routes/deployments";
import { exportRoutes } from "./routes/exports";
import { integrationRoutes } from "./routes/integrations";
import { remoteSiteRoutes } from "./routes/remote-sites";
import { keyRoutes } from "./routes/keys";
import { incidentsRoutes, monitorRoutes } from "./routes/monitors";
import { securityRoutes } from "./routes/security";
import { siteRoutes } from "./routes/sites";
import { systemRoutes } from "./routes/system";

type Env = { Bindings: AppEnv; Variables: { config: ReturnType<typeof loadConfig>; auth?: import("./middleware/auth").AuthContext } };

export function createApp(env: AppEnv) {
  const app = new Hono<Env>();
  const cfg = loadConfig(env);

  app.use("*", async (c, next) => {
    c.set("config", cfg);
    const origin = c.req.header("origin");
    if (origin) {
      if (origin === cfg.webOrigin || new URL(origin).host === new URL(c.req.url).host) {
        c.header("access-control-allow-origin", origin);
        c.header("access-control-allow-credentials", "true");
        c.header("vary", "Origin");
      }
      if (c.req.method === "OPTIONS") {
        c.header("access-control-allow-methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
        c.header("access-control-allow-headers", "content-type,authorization");
        c.header("access-control-max-age", "600");
        return c.body(null, 204);
      }
    }
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", "DENY");
    c.header("referrer-policy", "no-referrer");
    c.header("cache-control", "no-store");
    await next();
  });

  app.route("/v1", systemRoutes as never);
  app.route("/v1", collectRoutes as never);
  app.use("/v1/*", originGuard);
  app.route("/v1", authRoutes as never);
  app.route("/v1", siteRoutes as never);
  app.route("/v1", monitorRoutes as never);
  app.route("/v1", incidentsRoutes as never);
  app.route("/v1", analyticsRoutes as never);
  app.route("/v1", keyRoutes as never);
  app.route("/v1", deploymentRoutes as never);
  app.route("/v1", securityRoutes as never);
  app.route("/v1", integrationRoutes as never);
  app.route("/v1", remoteSiteRoutes as never);
  app.route("/v1", exportRoutes as never);

  if (cfg.dev) {
    app.post("/v1/dev/scheduler-run", async (c) => {
      const probe = (c.env as AppEnv & { tlsProbe?: import("./jobs/scheduler").SchedulerOptions["tlsProbe"] }).tlsProbe;
      const result = await runScheduler(env, cfg, { tlsProbe: probe });
      return c.json(result);
    });
  }

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    log("error", "unhandled_error", { message: err.message, path: c.req.path });
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
