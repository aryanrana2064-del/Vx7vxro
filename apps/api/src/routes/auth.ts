import { Hono } from "hono";
import type { AppEnv } from "../env";
import { TOTP, Secret } from "otpauth";
import type { z } from "zod";
import {
  bootstrapSchema,
  changePasswordSchema,
  loginSchema,
  mfaConfirmSchema,
  mfaVerifySchema,
  passwordSchema,
} from "@vxqor/shared";
import type { AppConfig } from "../env";
import { hashPassword, sha256Hex, timingSafeEqual, verifyPassword } from "../lib/crypto";
import { newId, randomBytes, randomToken, toBase64Url } from "../lib/ids";
import { log } from "../lib/log";
import { checkRateLimit } from "../lib/ratelimit";
import { recordAudit, recordSecurityEvent } from "../lib/security";
import {
  MFA_CHALLENGE_TTL_SECONDS,
  createSession,
  revokeAllSessions,
  revokeSession,
  sessionCookie,
} from "../lib/session";
import { addSeconds, nowIso } from "../lib/time";
import { clientIp, getAuth, requireSession } from "../middleware/auth";

const DUMMY_HASH =
  "pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function parseBody<T>(schema: z.ZodType<T>, raw: unknown): { data?: T; error?: string } {
  const res = schema.safeParse(raw);
  if (!res.success) {
    const issue = res.error.issues[0];
    return { error: issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid_request" };
  }
  return { data: res.data };
}

export const authRoutes = new Hono<{ Bindings: AppEnv; Variables: { auth?: import("../middleware/auth").AuthContext; config: AppConfig } }>();

authRoutes.post("/auth/bootstrap", async (c) => {
  const cfg = c.get("config");
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM owners").first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return c.json({ error: "bootstrap_unavailable" }, 403);
  const raw = await c.req.json().catch(() => null);
  const { data, error } = parseBody(bootstrapSchema, raw);
  if (!data) return c.json({ error }, 400);
  if (!cfg.bootstrapSecret || !timingSafeEqual(data.bootstrapSecret, cfg.bootstrapSecret)) {
    await recordSecurityEvent({ db: c.env.DB, kind: "bootstrap_failure", severity: "warn", title: "Bootstrap attempt with invalid secret", detail: null });
    return c.json({ error: "invalid_bootstrap_secret" }, 403);
  }
  const existing = await c.env.DB.prepare("SELECT id FROM owners WHERE email = ?").bind(data.email.toLowerCase()).first();
  if (existing) return c.json({ error: "bootstrap_unavailable" }, 403);
  const id = newId("own");
  const now = nowIso();
  const hash = await hashPassword(data.password, cfg.pbkdf2Iterations);
  await c.env.DB
    .prepare("INSERT INTO owners (id, email, password_hash, password_algo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, data.email.toLowerCase(), hash, `pbkdf2-sha256:${cfg.pbkdf2Iterations}`, now, now)
    .run();
  const session = await createSession(c.env.DB, id, { ip: clientIp(c), userAgent: c.req.header("user-agent") });
  await recordAudit({ db: c.env.DB, ownerId: id, category: "auth", action: "owner_bootstrap", actor: data.email.toLowerCase(), ip: clientIp(c), userAgent: c.req.header("user-agent") });
  c.header("set-cookie", sessionCookie(session.token, new URL(c.req.url), {}));
  return c.json({ owner: { id, email: data.email.toLowerCase(), createdAt: now, mfaEnabled: false } }, 201);
});

authRoutes.post("/auth/login", async (c) => {
  const cfg = c.get("config");
  const ip = clientIp(c);
  const raw = await c.req.json().catch(() => null);
  const { data, error } = parseBody(loginSchema, raw);
  if (!data) return c.json({ error }, 400);
  const email = data.email.toLowerCase();

  const ipLimit = await checkRateLimit(c.env.DB, `login:ip:${ip ?? "unknown"}`, 10, 900);
  if (!ipLimit.allowed) {
    c.header("retry-after", String(ipLimit.retryAfterSeconds));
    return c.json({ error: "rate_limited" }, 429);
  }
  const emailLimit = await checkRateLimit(c.env.DB, `login:email:${email}`, 8, 900);
  if (!emailLimit.allowed) {
    c.header("retry-after", String(emailLimit.retryAfterSeconds));
    return c.json({ error: "rate_limited" }, 429);
  }

  const owner = await c.env.DB
    .prepare("SELECT * FROM owners WHERE email = ?")
    .bind(email)
    .first<import("@vxqor/shared").OwnerRow>();

  const fail = async (reason: string) => {
    if (owner) {
      const fails = owner.failed_login_count + 1;
      const locked = fails >= 5 ? addSeconds(nowIso(), 900) : null;
      await c.env.DB
        .prepare("UPDATE owners SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?")
        .bind(fails, locked, nowIso(), owner.id)
        .run();
    }
    await recordSecurityEvent({ db: c.env.DB, kind: "auth_failure", severity: "warn", title: "Failed login attempt", detail: reason, siteId: null });
    await recordAudit({ db: c.env.DB, ownerId: owner?.id ?? null, category: "auth", action: "login_failed", actor: email, ip, userAgent: c.req.header("user-agent"), meta: { reason } });
    return c.json({ error: "invalid_credentials" }, 401);
  };

  if (!owner) {
    await verifyPassword(data.password, DUMMY_HASH);
    return fail("unknown_account");
  }
  if (owner.locked_until && new Date(owner.locked_until).getTime() > Date.now()) {
    return fail("locked");
  }
  const ok = await verifyPassword(data.password, owner.password_hash);
  if (!ok) return fail("bad_password");

  await c.env.DB
    .prepare("UPDATE owners SET failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?")
    .bind(nowIso(), owner.id)
    .run();

  if (owner.totp_secret && owner.totp_enabled_at) {
    const challengeId = newId("mfac");
    const now = nowIso();
    await c.env.DB
      .prepare("INSERT INTO mfa_challenges (id, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(challengeId, owner.id, now, addSeconds(now, MFA_CHALLENGE_TTL_SECONDS))
      .run();
    await recordAudit({ db: c.env.DB, ownerId: owner.id, category: "auth", action: "login_mfa_challenge", actor: email, ip, userAgent: c.req.header("user-agent") });
    return c.json({ mfaRequired: true, challenge: challengeId });
  }

  const session = await createSession(c.env.DB, owner.id, { ip, userAgent: c.req.header("user-agent"), mfaVerified: false });
  await recordAudit({ db: c.env.DB, ownerId: owner.id, category: "auth", action: "login_success", actor: email, ip, userAgent: c.req.header("user-agent") });
  c.header("set-cookie", sessionCookie(session.token, new URL(c.req.url), {}));
  return c.json({ mfaRequired: false, owner: { id: owner.id, email: owner.email, createdAt: owner.created_at, mfaEnabled: false } });
});

authRoutes.post("/auth/mfa/verify", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const { data, error } = parseBody(mfaVerifySchema, raw);
  if (!data) return c.json({ error }, 400);
  const challenge = await c.env.DB
    .prepare("SELECT * FROM mfa_challenges WHERE id = ? AND consumed_at IS NULL")
    .bind(data.challenge)
    .first<{ id: string; owner_id: string; expires_at: string }>();
  if (!challenge || new Date(challenge.expires_at).getTime() < Date.now()) {
    return c.json({ error: "invalid_challenge" }, 401);
  }
  const owner = await c.env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(challenge.owner_id).first<import("@vxqor/shared").OwnerRow>();
  if (!owner?.totp_secret) return c.json({ error: "invalid_challenge" }, 401);

  let verifiedBy: "totp" | "recovery" | null = null;
  if (/^\d{6}$/.test(data.code)) {
    const totp = new TOTP({ secret: Secret.fromBase32(owner.totp_secret), issuer: "VXQOR", label: owner.email, digits: 6, period: 30 });
    const delta = totp.validate({ token: data.code, window: 1 });
    if (delta !== null) verifiedBy = "totp";
  } else {
    const codeHash = await sha256Hex(data.code.toUpperCase());
    const code = await c.env.DB
      .prepare("SELECT id FROM recovery_codes WHERE owner_id = ? AND code_hash = ? AND used_at IS NULL")
      .bind(owner.id, codeHash)
      .first<{ id: string }>();
    if (code) {
      await c.env.DB.prepare("UPDATE recovery_codes SET used_at = ? WHERE id = ?").bind(nowIso(), code.id).run();
      verifiedBy = "recovery";
    }
  }
  if (!verifiedBy) {
    await recordSecurityEvent({ db: c.env.DB, kind: "mfa_failure", severity: "warn", title: "Failed MFA verification", detail: null });
    return c.json({ error: "invalid_code" }, 401);
  }
  await c.env.DB.prepare("UPDATE mfa_challenges SET consumed_at = ? WHERE id = ?").bind(nowIso(), challenge.id).run();
  const session = await createSession(c.env.DB, owner.id, { ip: clientIp(c), userAgent: c.req.header("user-agent"), mfaVerified: true });
  await recordAudit({ db: c.env.DB, ownerId: owner.id, category: "auth", action: "mfa_verified", actor: owner.email, ip: clientIp(c), userAgent: c.req.header("user-agent"), meta: { method: verifiedBy } });
  c.header("set-cookie", sessionCookie(session.token, new URL(c.req.url), {}));
  return c.json({ owner: { id: owner.id, email: owner.email, createdAt: owner.created_at, mfaEnabled: true } });
});

authRoutes.post("/auth/logout", requireSession, async (c) => {
  const auth = getAuth(c);
  if (auth.sessionId) await revokeSession(c.env.DB, auth.sessionId);
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "auth", action: "logout", actor: auth.ownerEmail, ip: clientIp(c), userAgent: c.req.header("user-agent") });
  c.header("set-cookie", sessionCookie("", new URL(c.req.url), { clear: true }));
  return c.json({ ok: true });
});

authRoutes.get("/auth/session", requireSession, async (c) => {
  const auth = getAuth(c);
  const owner = await c.env.DB.prepare("SELECT id, email, created_at, totp_enabled_at FROM owners WHERE id = ?").bind(auth.ownerId).first<{ id: string; email: string; created_at: string; totp_enabled_at: string | null }>();
  if (!owner) return c.json({ error: "unauthorized" }, 401);
  return c.json({ owner: { id: owner.id, email: owner.email, createdAt: owner.created_at, mfaEnabled: Boolean(owner.totp_enabled_at) } });
});

authRoutes.post("/auth/password", requireSession, async (c) => {
  const cfg = c.get("config");
  const auth = getAuth(c);
  const raw = await c.req.json().catch(() => null);
  const { data, error } = parseBody(changePasswordSchema, raw);
  if (!data) return c.json({ error }, 400);
  const owner = await c.env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(auth.ownerId).first<import("@vxqor/shared").OwnerRow>();
  if (!owner) return c.json({ error: "unauthorized" }, 401);
  const ok = await verifyPassword(data.currentPassword, owner.password_hash);
  if (!ok) {
    await recordSecurityEvent({ db: c.env.DB, kind: "password_change_failure", severity: "warn", title: "Password change with wrong current password", detail: null });
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const hash = await hashPassword(data.newPassword, cfg.pbkdf2Iterations);
  await c.env.DB.prepare("UPDATE owners SET password_hash = ?, password_algo = ?, updated_at = ? WHERE id = ?").bind(hash, `pbkdf2-sha256:${cfg.pbkdf2Iterations}`, nowIso(), owner.id).run();
  await revokeAllSessions(c.env.DB, owner.id, auth.sessionId);
  await recordAudit({ db: c.env.DB, ownerId: owner.id, category: "auth", action: "password_changed", actor: owner.email, ip: clientIp(c), userAgent: c.req.header("user-agent") });
  return c.json({ ok: true });
});

authRoutes.post("/auth/mfa/setup", requireSession, async (c) => {
  const auth = getAuth(c);
  const owner = await c.env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(auth.ownerId).first<import("@vxqor/shared").OwnerRow>();
  if (!owner) return c.json({ error: "unauthorized" }, 401);
  if (owner.totp_enabled_at) return c.json({ error: "mfa_already_enabled" }, 409);
  const secret = new Secret({ size: 20 });
  await c.env.DB.prepare("UPDATE owners SET totp_secret = ?, updated_at = ? WHERE id = ?").bind(secret.base32, nowIso(), owner.id).run();
  const totp = new TOTP({ secret, issuer: "VXQOR", label: owner.email, digits: 6, period: 30 });
  return c.json({ secret: secret.base32, otpauthUrl: totp.toString() });
});

function generateRecoveryCodes(): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const bytes = randomBytes(10);
    let code = "";
    for (const b of bytes) code += alphabet[b % alphabet.length];
    codes.push(code.slice(0, 5) + "-" + code.slice(5));
  }
  return codes;
}

authRoutes.post("/auth/mfa/confirm", requireSession, async (c) => {
  const auth = getAuth(c);
  const raw = await c.req.json().catch(() => null);
  const { data, error } = parseBody(mfaConfirmSchema, raw);
  if (!data) return c.json({ error }, 400);
  const owner = await c.env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(auth.ownerId).first<import("@vxqor/shared").OwnerRow>();
  if (!owner?.totp_secret || owner.totp_enabled_at) return c.json({ error: "mfa_state_invalid" }, 409);
  const totp = new TOTP({ secret: Secret.fromBase32(owner.totp_secret), issuer: "VXQOR", label: owner.email, digits: 6, period: 30 });
  if (totp.validate({ token: data.code, window: 1 }) === null) return c.json({ error: "invalid_code" }, 400);
  const codes = generateRecoveryCodes();
  const now = nowIso();
  await c.env.DB.prepare("DELETE FROM recovery_codes WHERE owner_id = ?").bind(owner.id).run();
  for (const code of codes) {
    await c.env.DB
      .prepare("INSERT INTO recovery_codes (id, owner_id, code_hash, created_at) VALUES (?, ?, ?, ?)")
      .bind(newId("rc"), owner.id, await sha256Hex(code), now)
      .run();
  }
  await c.env.DB.prepare("UPDATE owners SET totp_enabled_at = ?, updated_at = ? WHERE id = ?").bind(now, now, owner.id).run();
  if (auth.sessionId) {
    await c.env.DB.prepare("UPDATE sessions SET mfa_verified_at = ? WHERE id = ?").bind(now, auth.sessionId).run();
  }
  await recordAudit({ db: c.env.DB, ownerId: owner.id, category: "auth", action: "mfa_enabled", actor: owner.email, ip: clientIp(c), userAgent: c.req.header("user-agent") });
  return c.json({ recoveryCodes: codes });
});

authRoutes.post("/auth/mfa/disable", requireSession, async (c) => {
  const auth = getAuth(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = passwordSchema.safeParse(raw?.password);
  if (!parsed.success) return c.json({ error: "password required" }, 400);
  const owner = await c.env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(auth.ownerId).first<import("@vxqor/shared").OwnerRow>();
  if (!owner) return c.json({ error: "unauthorized" }, 401);
  if (!(await verifyPassword(parsed.data, owner.password_hash))) return c.json({ error: "invalid_credentials" }, 401);
  await c.env.DB.prepare("UPDATE owners SET totp_secret = NULL, totp_enabled_at = NULL, updated_at = ? WHERE id = ?").bind(nowIso(), owner.id).run();
  await c.env.DB.prepare("DELETE FROM recovery_codes WHERE owner_id = ?").bind(owner.id).run();
  await recordAudit({ db: c.env.DB, ownerId: owner.id, category: "auth", action: "mfa_disabled", actor: owner.email, ip: clientIp(c), userAgent: c.req.header("user-agent") });
  return c.json({ ok: true });
});

authRoutes.post("/auth/mfa/recovery-codes/regenerate", requireSession, async (c) => {
  const auth = getAuth(c);
  if (!auth.mfaVerified) return c.json({ error: "mfa_verification_required" }, 403);
  const raw = await c.req.json().catch(() => null);
  const parsed = passwordSchema.safeParse(raw?.password);
  if (!parsed.success) return c.json({ error: "password required" }, 400);
  const owner = await c.env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(auth.ownerId).first<import("@vxqor/shared").OwnerRow>();
  if (!owner) return c.json({ error: "unauthorized" }, 401);
  if (!(await verifyPassword(parsed.data, owner.password_hash))) return c.json({ error: "invalid_credentials" }, 401);
  const codes = generateRecoveryCodes();
  const now = nowIso();
  await c.env.DB.prepare("DELETE FROM recovery_codes WHERE owner_id = ?").bind(owner.id).run();
  for (const code of codes) {
    await c.env.DB.prepare("INSERT INTO recovery_codes (id, owner_id, code_hash, created_at) VALUES (?, ?, ?, ?)").bind(newId("rc"), owner.id, await sha256Hex(code), now).run();
  }
  await recordAudit({ db: c.env.DB, ownerId: owner.id, category: "auth", action: "recovery_codes_regenerated", actor: owner.email, ip: clientIp(c), userAgent: c.req.header("user-agent") });
  return c.json({ recoveryCodes: codes });
});

authRoutes.get("/auth/sessions", requireSession, async (c) => {
  const auth = getAuth(c);
  const rows = await c.env.DB
    .prepare("SELECT id, created_at, expires_at, last_seen_at, last_seen_ip, user_agent FROM sessions WHERE owner_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC LIMIT 50")
    .bind(auth.ownerId, nowIso())
    .all<{ id: string; created_at: string; expires_at: string; last_seen_at: string; last_seen_ip: string | null; user_agent: string | null }>();
  return c.json({
    sessions: rows.results.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      lastSeenAt: r.last_seen_at,
      lastSeenIp: r.last_seen_ip,
      userAgent: r.user_agent,
      current: r.id === auth.sessionId,
    })),
  });
});

authRoutes.post("/auth/sessions/:id/revoke", requireSession, async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_id = ? AND revoked_at IS NULL").bind(id, auth.ownerId).first<{ id: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  await revokeSession(c.env.DB, id);
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "auth", action: "session_revoked", actor: auth.ownerEmail, ip: clientIp(c), userAgent: c.req.header("user-agent"), meta: { sessionId: id } });
  if (id === auth.sessionId) c.header("set-cookie", sessionCookie("", new URL(c.req.url), { clear: true }));
  return c.json({ ok: true });
});

authRoutes.post("/auth/sessions/revoke-others", requireSession, async (c) => {
  const auth = getAuth(c);
  await revokeAllSessions(c.env.DB, auth.ownerId, auth.sessionId);
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "auth", action: "sessions_revoked_others", actor: auth.ownerEmail, ip: clientIp(c), userAgent: c.req.header("user-agent") });
  return c.json({ ok: true });
});

export const _tokenHelper = { randomToken, toBase64Url, log };
