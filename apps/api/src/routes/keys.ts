import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createKeySchema, rotateKeySchema } from "@vxqor/shared";
import { sha256Hex } from "../lib/crypto";
import { newId, randomToken } from "../lib/ids";
import { recordAudit } from "../lib/security";
import { addSeconds, nowIso } from "../lib/time";
import { clientIp, getAuth, requireSession } from "../middleware/auth";

export const keyRoutes = new Hono<{ Bindings: AppEnv; Variables: { auth?: import("../middleware/auth").AuthContext } }>();

keyRoutes.get("/keys", requireSession, async (c) => {
  const auth = getAuth(c);
  const rows = await c.env.DB
    .prepare("SELECT id, name, prefix, scopes, created_at, last_used_at, use_count, expires_at, revoked_at, rotated_from FROM api_keys WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100")
    .bind(auth.ownerId)
    .all();
  return c.json({ keys: rows.results.map((r) => ({ ...r, scopes: JSON.parse(r.scopes as string) })) });
});

keyRoutes.post("/keys", requireSession, async (c) => {
  const auth = getAuth(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = createKeySchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid_request" }, 400);
  const plaintext = `vxqor_${randomToken(24)}`;
  const hash = await sha256Hex(plaintext);
  const id = newId("key");
  const now = nowIso();
  const expiresAt = parsed.data.expiresInSeconds ? addSeconds(now, parsed.data.expiresInSeconds) : null;
  await c.env.DB
    .prepare("INSERT INTO api_keys (id, owner_id, name, prefix, key_hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, auth.ownerId, parsed.data.name, plaintext.slice(0, 12), hash, JSON.stringify(parsed.data.scopes), now, expiresAt)
    .run();
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "api_keys", action: "key_created", actor: auth.ownerEmail, ip: clientIp(c), userAgent: c.req.header("user-agent"), meta: { keyId: id, name: parsed.data.name, scopes: parsed.data.scopes } });
  // The full secret is returned exactly once and never stored in plaintext.
  return c.json({ key: { id, name: parsed.data.name, prefix: plaintext.slice(0, 12), scopes: parsed.data.scopes, createdAt: now, expiresAt }, secret: plaintext }, 201);
});

keyRoutes.post("/keys/:id/rotate", requireSession, async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM api_keys WHERE id = ? AND owner_id = ? AND revoked_at IS NULL").bind(id, auth.ownerId).first<{ id: string; name: string; scopes: string; expires_at: string | null }>();
  if (!existing) return c.json({ error: "not_found" }, 404);
  const raw = await c.req.json().catch(() => null);
  const parsed = rotateKeySchema.safeParse(raw ?? {});
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message }, 400);
  await c.env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").bind(nowIso(), id).run();
  const plaintext = `vxqor_${randomToken(24)}`;
  const hash = await sha256Hex(plaintext);
  const newKeyId = newId("key");
  const now = nowIso();
  const expiresAt = parsed.data.expiresInSeconds ? addSeconds(now, parsed.data.expiresInSeconds) : existing.expires_at;
  await c.env.DB
    .prepare("INSERT INTO api_keys (id, owner_id, name, prefix, key_hash, scopes, created_at, expires_at, rotated_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newKeyId, auth.ownerId, existing.name, plaintext.slice(0, 12), hash, existing.scopes, now, expiresAt, id)
    .run();
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "api_keys", action: "key_rotated", actor: auth.ownerEmail, ip: clientIp(c), meta: { oldKeyId: id, newKeyId } });
  return c.json({ key: { id: newKeyId, rotatedFrom: id }, secret: plaintext });
});

keyRoutes.post("/keys/:id/revoke", requireSession, async (c) => {
  const auth = getAuth(c);
  const res = await c.env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL").bind(nowIso(), c.req.param("id"), auth.ownerId).run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "api_keys", action: "key_revoked", actor: auth.ownerEmail, ip: clientIp(c), meta: { keyId: c.req.param("id") } });
  return c.json({ ok: true });
});

keyRoutes.get("/keys/:id/usage", requireSession, async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const key = await c.env.DB.prepare("SELECT id FROM api_keys WHERE id = ? AND owner_id = ?").bind(id, auth.ownerId).first();
  if (!key) return c.json({ error: "not_found" }, 404);
  const rows = await c.env.DB
    .prepare("SELECT hour, route, count, error_count FROM api_usage_hourly WHERE key_id = ? ORDER BY hour DESC LIMIT 720")
    .bind(id)
    .all();
  return c.json({ usage: rows.results });
});
