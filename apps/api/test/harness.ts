import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app";
import type { AppEnv } from "../src/env";
import { applyMigrations, openMemorySqliteD1, type SqliteD1 } from "../src/lib/sqlite-d1";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../migrations");

export interface Harness {
  env: AppEnv;
  d1: SqliteD1;
  fetch: (path: string, init?: RequestInit & { cookie?: string }) => Promise<Response>;
  json: (method: string, path: string, body?: unknown, opts?: { cookie?: string; origin?: string | null; headers?: Record<string, string> }) => Promise<{ status: number; body: any; setCookie?: string | null }>;
}

export function makeHarness(opts?: { bootstrapSecret?: string; encryptionKey?: string; dev?: boolean; iterations?: number; remote?: { url: string; token: string } }): Harness {
  const d1 = openMemorySqliteD1();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  applyMigrations(d1, files.map((f) => readFileSync(path.join(migrationsDir, f), "utf8")));
  const env: AppEnv = {
    DB: d1 as unknown as D1Database,
    VXQOR_WEB_ORIGIN: "http://localhost:5173",
    VXQOR_BOOTSTRAP_SECRET: opts?.bootstrapSecret ?? "test-bootstrap-secret",
    VXQOR_ENCRYPTION_KEY: opts?.encryptionKey ?? "a".repeat(64),
    VXQOR_PBKDF2_ITERATIONS: String(opts?.iterations ?? 20_000),
    VXQOR_MAX_CHECKS_PER_RUN: "5",
    VXQOR_RUNTIME: "node",
    VXQOR_DEV: opts?.dev ? "1" : undefined,
    VXQOR_REMOTE_API_URL: opts?.remote?.url,
    VXQOR_REMOTE_API_TOKEN: opts?.remote?.token,
  };
  const app = createApp(env);
  const fetch = (p: string, init?: RequestInit & { cookie?: string }) => {
    const headers = new Headers(init?.headers);
    if (init?.cookie) headers.set("cookie", init.cookie);
    return Promise.resolve(app.fetch(new Request(`http://api.test${p}`, { ...init, headers }), env, undefined as never));
  };
  const json: Harness["json"] = async (method, p, body, o) => {
    let opts = o;
    let payload: unknown = body;
    const isRead = method === "GET" || method === "HEAD";
    if (isRead && body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every((k) => ["cookie", "origin", "headers"].includes(k))) {
      opts = body as NonNullable<typeof o>;
      payload = undefined;
    }
    const headers: Record<string, string> = { "content-type": "application/json", ...(opts?.headers ?? {}) };
    const origin = opts?.origin === null ? undefined : opts?.origin ?? "http://localhost:5173";
    if (origin) headers["origin"] = origin;
    const res = await fetch(p, { method, body: payload === undefined ? undefined : JSON.stringify(payload), headers, cookie: opts?.cookie });
    const setCookie = res.headers.get("set-cookie");
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, setCookie };
  };
  return { env, d1, fetch, json };
}

export function cookieFrom(setCookie: string | null | undefined): string | undefined {
  if (!setCookie) return undefined;
  return setCookie.split(";")[0];
}

export async function bootstrapOwner(h: Harness, email = "owner@example.com", password = "correct-horse-battery") {
  const res = await h.json("POST", "/v1/auth/bootstrap", { bootstrapSecret: "test-bootstrap-secret", email, password });
  return { res, cookie: cookieFrom(res.setCookie) };
}
