import { Hono } from "hono";
import type { AppEnv } from "../env";
import { MAX_EXPORT_ROWS, exportQuerySchema } from "@vxqor/shared";
import { requireScope } from "../middleware/auth";

export const exportRoutes = new Hono<{ Bindings: AppEnv }>();

interface DatasetDef {
  sql: (from: string, to: string, siteId?: string) => { sql: string; params: unknown[] };
  columns: string[];
}

const DATASETS: Record<string, DatasetDef> = {
  analytics: {
    sql: (from, to, siteId) => ({
      sql: `SELECT ts, event_type, custom_name, path, referrer_category, referrer_domain, browser, device, country FROM analytics_events WHERE ts >= ? AND ts <= ? ${siteId ? "AND site_id = ?" : ""} ORDER BY ts ASC LIMIT ${MAX_EXPORT_ROWS}`,
      params: siteId ? [from, to, siteId] : [from, to],
    }),
    columns: ["ts", "event_type", "custom_name", "path", "referrer_category", "referrer_domain", "browser", "device", "country"],
  },
  monitoring: {
    sql: (from, to, siteId) => ({
      sql: `SELECT r.checked_at, m.url, r.duration_ms, r.status_code, r.success, r.error_category, r.error_message, r.timed_out FROM monitor_results r JOIN monitors m ON m.id = r.monitor_id ${siteId ? "JOIN sites s ON s.id = m.site_id" : ""} WHERE r.checked_at >= ? AND r.checked_at <= ? ${siteId ? "AND s.id = ?" : ""} ORDER BY r.checked_at ASC LIMIT ${MAX_EXPORT_ROWS}`,
      params: siteId ? [from, to, siteId] : [from, to],
    }),
    columns: ["checked_at", "url", "duration_ms", "status_code", "success", "error_category", "error_message", "timed_out"],
  },
  incidents: {
    sql: (from, to, siteId) => ({
      sql: `SELECT i.detected_at, i.status, i.trigger_condition, i.acknowledged_at, i.resolved_at, s.name AS site FROM incidents i JOIN sites s ON s.id = i.site_id WHERE i.detected_at >= ? AND i.detected_at <= ? ${siteId ? "AND s.id = ?" : ""} ORDER BY i.detected_at ASC LIMIT ${MAX_EXPORT_ROWS}`,
      params: siteId ? [from, to, siteId] : [from, to],
    }),
    columns: ["detected_at", "status", "trigger_condition", "acknowledged_at", "resolved_at", "site"],
  },
  performance: {
    sql: (from, to, siteId) => ({
      sql: `SELECT ts, metric, value, path, browser, device FROM perf_events WHERE ts >= ? AND ts <= ? ${siteId ? "AND site_id = ?" : ""} ORDER BY ts ASC LIMIT ${MAX_EXPORT_ROWS}`,
      params: siteId ? [from, to, siteId] : [from, to],
    }),
    columns: ["ts", "metric", "value", "path", "browser", "device"],
  },
  errors: {
    sql: (from, to, siteId) => ({
      sql: `SELECT first_seen_at, last_seen_at, category, message, path, release_tag, count, status FROM error_events WHERE last_seen_at >= ? AND last_seen_at <= ? ${siteId ? "AND site_id = ?" : ""} ORDER BY last_seen_at ASC LIMIT ${MAX_EXPORT_ROWS}`,
      params: siteId ? [from, to, siteId] : [from, to],
    }),
    columns: ["first_seen_at", "last_seen_at", "category", "message", "path", "release_tag", "count", "status"],
  },
  deployments: {
    sql: (from, to, siteId) => ({
      sql: `SELECT created_at, source, environment, status, commit_sha, commit_message, branch, url FROM deployments WHERE created_at >= ? AND created_at <= ? ${siteId ? "AND site_id = ?" : ""} ORDER BY created_at ASC LIMIT ${MAX_EXPORT_ROWS}`,
      params: siteId ? [from, to, siteId] : [from, to],
    }),
    columns: ["created_at", "source", "environment", "status", "commit_sha", "commit_message", "branch", "url"],
  },
  audit: {
    sql: (from, to) => ({
      sql: `SELECT created_at, category, action, actor, ip FROM audit_events WHERE created_at >= ? AND created_at <= ? ORDER BY created_at ASC LIMIT ${MAX_EXPORT_ROWS}`,
      params: [from, to],
    }),
    columns: ["created_at", "category", "action", "actor", "ip"],
  },
  api_usage: {
    sql: (from, to) => ({
      sql: `SELECT u.hour, k.name, k.prefix, u.route, u.count, u.error_count FROM api_usage_hourly u LEFT JOIN api_keys k ON k.id = u.key_id WHERE u.hour >= ? AND u.hour <= ? ORDER BY u.hour ASC LIMIT ${MAX_EXPORT_ROWS}`,
      params: [from, to],
    }),
    columns: ["hour", "key_name", "key_prefix", "route", "count", "error_count"],
  },
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

exportRoutes.get("/exports", requireScope("exports:read"), async (c) => {
  const parsed = exportQuerySchema.safeParse({
    dataset: c.req.query("dataset"),
    from: c.req.query("from"),
    to: c.req.query("to"),
    format: c.req.query("format"),
    siteId: c.req.query("siteId"),
  });
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid_query" }, 400);
  const q = parsed.data;
  const def = DATASETS[q.dataset];
  if (!def) return c.json({ error: "unknown_dataset" }, 400);
  const from = q.from ? new Date(q.from).toISOString() : new Date(Date.now() - 30 * 86400_000).toISOString();
  const to = q.to ? new Date(q.to).toISOString() : new Date().toISOString();
  const { sql, params } = def.sql(from, to, q.siteId);
  const rows = await c.env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
  const filename = `vxqor-${q.dataset}-${from.slice(0, 10)}-${to.slice(0, 10)}`;
  if (q.format === "json") {
    c.header("content-disposition", `attachment; filename="${filename}.json"`);
    return c.json({ dataset: q.dataset, from, to, rowCount: rows.results.length, truncated: rows.results.length >= MAX_EXPORT_ROWS, rows: rows.results });
  }
  const lines = [def.columns.join(",")];
  for (const row of rows.results) {
    lines.push(def.columns.map((col) => csvEscape(row[col])).join(","));
  }
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", `attachment; filename="${filename}.csv"`);
  return c.body(lines.join("\r\n"));
});
