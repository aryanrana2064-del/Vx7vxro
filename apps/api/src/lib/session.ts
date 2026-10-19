import { COOKIE_NAME } from "@vxqor/shared";
import type { OwnerRow, SessionRow } from "@vxqor/shared";
import { sha256Hex } from "./crypto";
import { newId, randomToken } from "./ids";
import { addSeconds, nowIso } from "./time";

export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h
export const MFA_CHALLENGE_TTL_SECONDS = 300;

export interface CreatedSession {
  id: string;
  token: string;
  row: SessionRow;
}

export async function createSession(
  db: D1Database,
  ownerId: string,
  opts: { ip?: string | null; userAgent?: string | null; mfaVerified?: boolean },
): Promise<CreatedSession> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const id = newId("ses");
  const now = nowIso();
  const row: SessionRow = {
    id,
    owner_id: ownerId,
    token_hash: tokenHash,
    created_at: now,
    expires_at: addSeconds(now, SESSION_TTL_SECONDS),
    last_seen_at: now,
    last_seen_ip: opts.ip ?? null,
    user_agent: opts.userAgent ?? null,
    revoked_at: null,
    mfa_verified_at: opts.mfaVerified ? now : null,
  };
  await db
    .prepare(
      "INSERT INTO sessions (id, owner_id, token_hash, created_at, expires_at, last_seen_at, last_seen_ip, user_agent, revoked_at, mfa_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      row.id,
      row.owner_id,
      row.token_hash,
      row.created_at,
      row.expires_at,
      row.last_seen_at,
      row.last_seen_ip,
      row.user_agent,
      row.revoked_at,
      row.mfa_verified_at,
    )
    .run();
  return { id, token, row };
}

export async function findSessionByToken(
  db: D1Database,
  token: string,
): Promise<{ session: SessionRow; owner: OwnerRow } | null> {
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      "SELECT s.*, o.email, o.password_hash, o.password_algo, o.totp_secret, o.totp_enabled_at, o.failed_login_count, o.locked_until FROM sessions s JOIN owners o ON o.id = s.owner_id WHERE s.token_hash = ?",
    )
    .bind(tokenHash)
    .first<SessionRow & OwnerRow & { email: string }>();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  const session: SessionRow = {
    id: row.id,
    owner_id: row.owner_id,
    token_hash: row.token_hash,
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_seen_at: row.last_seen_at,
    last_seen_ip: row.last_seen_ip,
    user_agent: row.user_agent,
    revoked_at: row.revoked_at,
    mfa_verified_at: row.mfa_verified_at,
  };
  const owner: OwnerRow = {
    id: row.owner_id,
    email: row.email,
    password_hash: row.password_hash,
    password_algo: row.password_algo,
    created_at: row.created_at,
    updated_at: row.updated_at,
    totp_secret: row.totp_secret,
    totp_enabled_at: row.totp_enabled_at,
    failed_login_count: row.failed_login_count,
    locked_until: row.locked_until,
  };
  return { session, owner };
}

export async function touchSession(db: D1Database, sessionId: string, ip: string | null): Promise<void> {
  await db
    .prepare("UPDATE sessions SET last_seen_at = ?, last_seen_ip = COALESCE(?, last_seen_ip) WHERE id = ?")
    .bind(nowIso(), ip, sessionId)
    .run();
}

export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(nowIso(), sessionId).run();
}

export async function revokeAllSessions(db: D1Database, ownerId: string, exceptId?: string): Promise<void> {
  if (exceptId) {
    await db
      .prepare("UPDATE sessions SET revoked_at = ? WHERE owner_id = ? AND id <> ? AND revoked_at IS NULL")
      .bind(nowIso(), ownerId, exceptId)
      .run();
  } else {
    await db
      .prepare("UPDATE sessions SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL")
      .bind(nowIso(), ownerId)
      .run();
  }
}

export function sessionCookie(token: string, url: URL, opts: { maxAge?: number; clear?: boolean }): string {
  const secure = url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
  const parts = [
    `${COOKIE_NAME}=${opts.clear ? "" : token}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${secure ? "None" : "Lax"}`,
    opts.clear ? "Max-Age=0" : `Max-Age=${opts.maxAge ?? SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME) return rest.join("=") || null;
  }
  return null;
}
