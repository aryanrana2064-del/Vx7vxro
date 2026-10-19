import type { AppEnv } from "./env";
import { loadConfig } from "./env";
import { runScheduler } from "./jobs/scheduler";
import { createApp } from "./app";
import { log } from "./lib/log";

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const app = createApp(env);
    return app.fetch(request, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    const cfg = loadConfig(env);
    ctx.waitUntil(runScheduler(env, cfg));
    log("info", "cron_triggered", { cron: event.cron });
  },
};
