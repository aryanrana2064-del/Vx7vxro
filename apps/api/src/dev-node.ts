/**
 * Local Node development server: same Hono app, node:sqlite-backed D1 shim,
 * interval-based scheduler and real TLS certificate probes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import type { AppEnv } from "./env";
import { loadConfig } from "./env";
import { runScheduler, type SchedulerOptions } from "./jobs/scheduler";
import { log } from "./lib/log";
import { applyMigrations, openSqliteD1 } from "./lib/sqlite-d1";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function loadDotEnv(): string | null {
  for (const file of [path.resolve(root, "../../.env"), path.resolve(root, ".env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let value = (m[2] ?? "").trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[m[1] as string] === undefined) process.env[m[1] as string] = value;
    }
    return file;
  }
  return null;
}

const dotEnvFile = loadDotEnv();
const dataDir = path.join(root, ".dev");
mkdirSync(dataDir, { recursive: true });
const dbFile = process.env.VXQOR_DB_FILE ?? path.join(dataDir, "vxqor.sqlite");
const d1 = openSqliteD1(dbFile);

const migrationsDir = path.join(root, "migrations");
const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

const tlsProbe: SchedulerOptions["tlsProbe"] = (host, port) =>
  new Promise((resolve) => {
    const socket = tlsConnect({ host, port, servername: host, timeout: 8000 }, () => {
      const validTo = socket.getPeerCertificate()?.valid_to ?? null;
      socket.end();
      resolve(validTo ? new Date(validTo).toISOString() : null);
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });

const env: AppEnv & { tlsProbe?: SchedulerOptions["tlsProbe"] } = {
  DB: d1 as unknown as D1Database,
  VXQOR_WEB_ORIGIN: process.env.VXQOR_WEB_ORIGIN,
  VXQOR_BOOTSTRAP_SECRET: process.env.VXQOR_BOOTSTRAP_SECRET,
  VXQOR_ENCRYPTION_KEY: process.env.VXQOR_ENCRYPTION_KEY,
  VXQOR_PBKDF2_ITERATIONS: process.env.VXQOR_PBKDF2_ITERATIONS,
  VXQOR_MAX_CHECKS_PER_RUN: process.env.VXQOR_MAX_CHECKS_PER_RUN,
  VXQOR_RETENTION: process.env.VXQOR_RETENTION,
  VXQOR_REMOTE_API_URL: process.env.VXQOR_REMOTE_API_URL,
  VXQOR_REMOTE_API_TOKEN: process.env.VXQOR_REMOTE_API_TOKEN,
  VXQOR_RUNTIME: "node",
  VXQOR_DEV: "1",
  tlsProbe,
};

const cfg = loadConfig(env);
if (!cfg.bootstrapSecret) {
  log("warn", "dev_bootstrap_secret_default", { hint: "set VXQOR_BOOTSTRAP_SECRET in .env; using dev-only default" });
  env.VXQOR_BOOTSTRAP_SECRET = "dev-bootstrap-secret";
}
if (!cfg.encryptionKey) {
  log("warn", "dev_encryption_key_default", { hint: "set VXQOR_ENCRYPTION_KEY in .env; using dev-only default" });
  env.VXQOR_ENCRYPTION_KEY = "a".repeat(64);
}

const app = createApp(env);
const port = Number(process.env.PORT ?? 8787);

async function main() {
  const existing = await d1.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='owners'").first<{ name: string }>();
  if (!existing) {
    applyMigrations(d1, migrationFiles.map((f) => readFileSync(path.join(migrationsDir, f), "utf8")));
    log("info", "migrations_applied", { files: migrationFiles });
  }
  const server = serve({ fetch: (req) => app.fetch(req, env, undefined as never), port }, (info) => {
    log("info", "dev_node_listening", { port: info.port, dotEnvFile, dbFile });
  });
  const timer = setInterval(() => {
    void runScheduler(env, loadConfig(env), { tlsProbe });
  }, 60_000);
  process.on("SIGINT", () => {
    clearInterval(timer);
    server.close();
    d1.close();
    process.exit(0);
  });
  void runScheduler(env, loadConfig(env), { tlsProbe });
}

void main();
void createServer;
