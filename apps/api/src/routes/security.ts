import { Hono } from "hono";
import type { AppEnv } from "../env";
import { paginationSchema } from "@vxqor/shared";
import { requireScope } from "../middleware/auth";

export const securityRoutes = new Hono<{ Bindings: AppEnv }>();

securityRoutes.get("/security/events", requireScope("security:read"), async (c) => {
  const q = paginationSchema.parse({ page: c.req.query("page"), perPage: c.req.query("perPage") });
  const kind = c.req.query("kind");
  const severity = c.req.query("severity");
  const where: string[] = [];
  const params: unknown[] = [];
  if (kind) {
    where.push("kind = ?");
    params.push(kind);
  }
  if (severity) {
    where.push("severity = ?");
    params.push(severity);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM security_events ${clause}`).bind(...params).first<{ n: number }>();
  const rows = await c.env.DB
    .prepare(`SELECT * FROM security_events ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, q.perPage, (q.page - 1) * q.perPage)
    .all();
  return c.json({ items: rows.results, page: q.page, perPage: q.perPage, total: total?.n ?? 0 });
});

securityRoutes.get("/security/checks", requireScope("security:read"), async (c) => {
  const siteId = c.req.query("siteId");
  const rows = siteId
    ? await c.env.DB.prepare("SELECT * FROM security_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT 300").bind(siteId).all()
    : await c.env.DB.prepare("SELECT * FROM security_checks ORDER BY checked_at DESC LIMIT 300").all();
  const dns = await c.env.DB.prepare("SELECT * FROM dns_records ORDER BY last_seen_at DESC LIMIT 100").all();
  return c.json({ checks: rows.results, dnsRecords: dns.results });
});

securityRoutes.get("/audit", requireScope("audit:read"), async (c) => {
  const q = paginationSchema.parse({ page: c.req.query("page"), perPage: c.req.query("perPage") });
  const category = c.req.query("category");
  const where = category ? "WHERE category = ?" : "";
  const params: unknown[] = category ? [category] : [];
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_events ${where}`).bind(...params).first<{ n: number }>();
  const rows = await c.env.DB
    .prepare(`SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, q.perPage, (q.page - 1) * q.perPage)
    .all();
  return c.json({ items: rows.results, page: q.page, perPage: q.perPage, total: total?.n ?? 0 });
});
