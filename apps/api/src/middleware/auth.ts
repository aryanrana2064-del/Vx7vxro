import type { Context, MiddlewareHandler } from "hono";
import type { ApiKeyRow, OwnerRow, SessionRow } from "@vxqor/shared";
import type { Scope } from "@vxqor/shared";
import { sha256Hex } from "../lib/crypto";
import { findSessionByToken, readSessionCookie, touchSession } from "../lib/session";
import { nowIso } from "../lib/time";

export interface AuthContext {
  kind: "session" | "api_key";
  ownerId: string;
  ownerEmail: string;
  sessionId?: string;
  apiKeyId?: string;
  scopes: Scope[] | null; // null = full access (session)
  mfaVerified: boolean;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

export function clientIp(c: Context): string | null {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/** Hono's executionCtx getter throws outside Workers; degrade to fire-and-forget. */
export function waitUntil(c: Context, promise: Promise<unknown>): void {
  try {
    c.executionCtx.waitUntil(promise);
  } catch {
    promise.catch(() => undefined);
  }
}

export async function resolveSession(c: Context): Promise<AuthContext | null> {
  const token = readSessionCookie(c.req.raw);
  if (!token) return null;
  const db = c.env.DB as D1Database;
  const found = await findSessionByToken(db, token);
  if (!found) return null;
  // Throttled last_seen update: at most once per 5 minutes per session.
  if (Date.now() - new Date(found.session.last_seen_at).getTime() > 5 * 60_000) {
    waitUntil(c, touchSession(db, found.session.id, clientIp(c)));
  }
  return {
    kind: "session",
    ownerId: found.owner.id,
    ownerEmail: found.owner.email,
    sessionId: found.session.id,
    scopes: null,
    mfaVerified: Boolean(found.session.mfa_verified_at),
  };
}

async function resolveApiKey(c: Context): Promise<AuthContext | null> {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const raw = header.slice(7).trim();
  if (!raw.startsWith("vxqor_")) return null;
  const hash = await sha256Hex(raw);
  const db = c.env.DB as D1Database;
  const key = await db
    .prepare("SELECT k.*, o.email FROM api_keys k JOIN owners o ON o.id = k.owner_id WHERE k.key_hash = ?")
    .bind(hash)
    .first<ApiKeyRow & { email: string }>();
  if (!key) return null;
  if (key.revoked_at) return null;
  if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) return null;
  waitUntil(
    c,
    db
      .prepare("UPDATE api_keys SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?")
      .bind(nowIso(), key.id)
      .run(),
  );
  let scopes: Scope[] = [];
  try {
    scopes = JSON.parse(key.scopes) as Scope[];
  } catch {
    return null;
  }
  return { kind: "api_key", ownerId: key.owner_id, ownerEmail: key.email, apiKeyId: key.id, scopes, mfaVerified: false };
}

/** Requires an authenticated owner session (cookie). API keys are not accepted. */
export const requireSession: MiddlewareHandler = async (c, next) => {
  const auth = await resolveSession(c);
  if (!auth) return c.json({ error: "unauthorized" }, 401);
  c.set("auth", auth);
  await next();
};

/** Requires session OR an API key carrying the given scope. */
export function requireScope(scope: Scope): MiddlewareHandler {
  return async (c, next) => {
    const session = await resolveSession(c);
    if (session) {
      c.set("auth", session);
      await next();
      return;
    }
    const key = await resolveApiKey(c);
    if (!key) return c.json({ error: "unauthorized" }, 401);
    if (!key.scopes?.includes(scope)) return c.json({ error: "forbidden", required: scope }, 403);
    c.set("auth", key);
    await next();
    const keyId = key.apiKeyId;
    if (keyId) {
      const hour = `${new Date().toISOString().slice(0, 13)}:00:00.000Z`;
      const route = c.req.path.replace(/\/[A-Za-z0-9_-]{6,}($|\?)/g, "/:id$1");
      const isErr = c.res.status >= 400 ? 1 : 0;
      waitUntil(
        c,
        c.env.DB.prepare(
          "INSERT INTO api_usage_hourly (key_id, hour, route, count, error_count) VALUES (?, ?, ?, 1, ?) ON CONFLICT(key_id, hour, route) DO UPDATE SET count = count + 1, error_count = error_count + ?",
        )
          .bind(keyId, hour, route, isErr, isErr)
          .run(),
      );
    }
  };
}

/**
 * CSRF/origin guard: cookie-authenticated mutations must come from the
 * configured web origin. JSON content type already forces a CORS preflight,
 * this adds defense in depth.
 */
export const originGuard: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  const hasCookie = Boolean(readSessionCookie(c.req.raw));
  if (!hasCookie) return next(); // bearer-key requests are not cookie-carrying
  const origin = c.req.header("origin");
  // Browsers always send Origin on cross/same-origin POST; its absence means a
  // non-browser client, which cannot perform cookie CSRF in practice.
  if (!origin) return next();
  const webOrigin: string = (c.env.VXQOR_WEB_ORIGIN ?? "http://localhost:5173").replace(/\/+$/, "");
  const sameHost = new URL(origin).host === new URL(c.req.url).host;
  if (origin !== webOrigin && !sameHost) {
    return c.json({ error: "origin_not_allowed" }, 403);
  }
  return next();
};

export function getAuth(c: Context): AuthContext {
  const auth = c.get("auth") as AuthContext | undefined;
  if (!auth) throw new Error("auth middleware missing");
  return auth;
}

export function ownerOf(c: Context): { id: string; email: string } {
  const auth = getAuth(c);
  return { id: auth.ownerId, email: auth.ownerEmail };
}

export type { OwnerRow, SessionRow };
