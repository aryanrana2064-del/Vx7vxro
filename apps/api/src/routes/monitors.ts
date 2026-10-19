import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createMonitorSchema, updateMonitorSchema, rangeSchema } from "@vxqor/shared";
import type { MonitorRow } from "@vxqor/shared";
import { runCheck } from "../lib/checker";
import { newId } from "../lib/ids";
import { applyCheckResult } from "../lib/monitor-state";
import { recordAudit } from "../lib/security";
import { validateTarget } from "../lib/ssrf";
import { bucketMs, floorToBucket, percentile, rangeBounds } from "../lib/time";
import { nowIso } from "../lib/time";
import { clientIp, getAuth, requireScope, requireSession } from "../middleware/auth";

export const monitorRoutes = new Hono<{ Bindings: AppEnv; Variables: { auth?: import("../middleware/auth").AuthContext; config: import("../env").AppConfig } }>();

monitorRoutes.get("/monitors", requireScope("monitoring:read"), async (c) => {
  const siteId = c.req.query("siteId");
  const rows = siteId
    ? await c.env.DB.prepare("SELECT m.*, s.name AS site_name FROM monitors m JOIN sites s ON s.id = m.site_id WHERE m.site_id = ? ORDER BY m.created_at DESC").bind(siteId).all()
    : await c.env.DB.prepare("SELECT m.*, s.name AS site_name FROM monitors m JOIN sites s ON s.id = m.site_id ORDER BY m.created_at DESC LIMIT 500").all();
  return c.json({ monitors: rows.results });
});

monitorRoutes.post("/monitors", requireSession, async (c) => {
  const auth = getAuth(c);
  const raw = await c.req.json().catch(() => null);
  const parsed = createMonitorSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid_request", field: parsed.error.issues[0]?.path.join(".") }, 400);
  const data = parsed.data;
  const site = await c.env.DB.prepare("SELECT id, disabled_at FROM sites WHERE id = ?").bind(data.siteId).first<{ id: string; disabled_at: string | null }>();
  if (!site) return c.json({ error: "site_not_found" }, 404);
  if (site.disabled_at) return c.json({ error: "site_disabled" }, 409);
  const validation = await validateTarget(data.url);
  if (!validation.ok) {
    await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "security", action: "monitor_target_rejected", actor: auth.ownerEmail, ip: clientIp(c), meta: { url: data.url, reason: validation.reason } });
    return c.json({ error: "target_rejected", reason: validation.reason }, 400);
  }
  const dup = await c.env.DB.prepare("SELECT id FROM monitors WHERE site_id = ? AND url = ?").bind(data.siteId, data.url).first();
  if (dup) return c.json({ error: "monitor_exists" }, 409);
  const id = newId("mon");
  const now = nowIso();
  await c.env.DB
    .prepare(
      "INSERT INTO monitors (id, site_id, url, method, interval_seconds, timeout_ms, max_redirects, failure_threshold, expected_status_min, expected_status_max, slow_threshold_ms, enabled, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'unknown')",
    )
    .bind(id, data.siteId, data.url, data.method, data.intervalSeconds, data.timeoutMs, data.maxRedirects, data.failureThreshold, data.expectedStatusMin, data.expectedStatusMax, data.slowThresholdMs, now, now)
    .run();
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "monitoring", action: "monitor_created", actor: auth.ownerEmail, ip: clientIp(c), userAgent: c.req.header("user-agent"), meta: { monitorId: id, url: data.url } });
  return c.json({ monitor: { id, ...data } }, 201);
});

monitorRoutes.patch("/monitors/:id", requireSession, async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const monitor = await c.env.DB.prepare("SELECT * FROM monitors WHERE id = ?").bind(id).first<MonitorRow>();
  if (!monitor) return c.json({ error: "not_found" }, 404);
  const raw = await c.req.json().catch(() => null);
  const parsed = updateMonitorSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid_request" }, 400);
  const data = parsed.data;
  if (data.url) {
    const validation = await validateTarget(data.url);
    if (!validation.ok) return c.json({ error: "target_rejected", reason: validation.reason }, 400);
  }
  const now = nowIso();
  const sets: string[] = [];
  const params: unknown[] = [];
  const map: Record<string, unknown> = {
    url: data.url,
    method: data.method,
    interval_seconds: data.intervalSeconds,
    timeout_ms: data.timeoutMs,
    max_redirects: data.maxRedirects,
    failure_threshold: data.failureThreshold,
    expected_status_min: data.expectedStatusMin,
    expected_status_max: data.expectedStatusMax,
    slow_threshold_ms: data.slowThresholdMs,
    enabled: data.enabled === undefined ? undefined : data.enabled ? 1 : 0,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val !== undefined) {
      sets.push(`${col} = ?`);
      params.push(val);
    }
  }
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    params.push(now, id);
    await c.env.DB.prepare(`UPDATE monitors SET ${sets.join(", ")} WHERE id = ?`).bind(...params).run();
  }
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "monitoring", action: "monitor_updated", actor: auth.ownerEmail, ip: clientIp(c), meta: { monitorId: id, changes: Object.keys(data) } });
  return c.json({ ok: true });
});

monitorRoutes.delete("/monitors/:id", requireSession, async (c) => {
  const auth = getAuth(c);
  const id = c.req.param("id");
  const monitor = await c.env.DB.prepare("SELECT id FROM monitors WHERE id = ?").bind(id).first();
  if (!monitor) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM monitors WHERE id = ?").bind(id).run();
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "monitoring", action: "monitor_deleted", actor: auth.ownerEmail, ip: clientIp(c), meta: { monitorId: id } });
  return c.json({ ok: true });
});

monitorRoutes.post("/monitors/:id/check-now", requireSession, async (c) => {
  const auth = getAuth(c);
  const monitor = await c.env.DB.prepare("SELECT * FROM monitors WHERE id = ?").bind(c.req.param("id")).first<MonitorRow>();
  if (!monitor) return c.json({ error: "not_found" }, 404);
  const out = await runCheck({
    url: monitor.url,
    method: monitor.method,
    timeoutMs: monitor.timeout_ms,
    maxRedirects: monitor.max_redirects,
    expectedStatusMin: monitor.expected_status_min,
    expectedStatusMax: monitor.expected_status_max,
  });
  const state = await applyCheckResult(c.env.DB, monitor, out);
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "monitoring", action: "monitor_manual_check", actor: auth.ownerEmail, ip: clientIp(c), meta: { monitorId: monitor.id, success: out.success } });
  return c.json({ result: out, state });
});

monitorRoutes.get("/monitors/:id/results", requireScope("monitoring:read"), async (c) => {
  const id = c.req.param("id");
  const range = rangeSchema.parse(c.req.query("range") ?? "24h");
  const { from } = rangeBounds(range);
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 500);
  const rows = await c.env.DB
    .prepare("SELECT * FROM monitor_results WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at DESC LIMIT ?")
    .bind(id, from, limit)
    .all();
  return c.json({ results: rows.results, range });
});

monitorRoutes.get("/monitors/:id/summary", requireScope("monitoring:read"), async (c) => {
  const id = c.req.param("id");
  const range = rangeSchema.parse(c.req.query("range") ?? "7d");
  const { from } = rangeBounds(range);
  const rows = await c.env.DB
    .prepare("SELECT checked_at, duration_ms, success FROM monitor_results WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at ASC LIMIT 5000")
    .bind(id, from)
    .all<{ checked_at: string; duration_ms: number; success: number }>();
  const results = rows.results;
  const successes = results.filter((r) => r.success === 1).length;
  const durations = results.filter((r) => r.success === 1).map((r) => r.duration_ms).sort((a, b) => a - b);
  const bucket = bucketMs(range);
  const series = new Map<number, { total: number; ok: number; lat: number[] }>();
  for (const r of results) {
    const key = floorToBucket(new Date(r.checked_at).getTime(), bucket);
    const entry = series.get(key) ?? { total: 0, ok: 0, lat: [] };
    entry.total += 1;
    if (r.success === 1) {
      entry.ok += 1;
      entry.lat.push(r.duration_ms);
    }
    series.set(key, entry);
  }
  const timeseries = [...series.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, v]) => ({
      ts: new Date(ts).toISOString(),
      uptimePct: v.total ? (v.ok / v.total) * 100 : 0,
      p50: percentile(v.lat.sort((a, b) => a - b), 50),
      count: v.total,
    }));
  return c.json({
    range,
    checks: results.length,
    uptimePct: results.length ? (successes / results.length) * 100 : null,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    timeseries,
    sampleNote: results.length === 0 ? "No checks recorded in this window yet." : undefined,
  });
});

export const incidentsRoutes = new Hono<{ Bindings: AppEnv; Variables: { auth?: import("../middleware/auth").AuthContext; config: import("../env").AppConfig } }>();

incidentsRoutes.get("/incidents", requireScope("monitoring:read"), async (c) => {
  const status = c.req.query("status");
  const siteId = c.req.query("siteId");
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) {
    where.push("i.status = ?");
    params.push(status);
  }
  if (siteId) {
    where.push("i.site_id = ?");
    params.push(siteId);
  }
  const sql = `SELECT i.*, m.url AS monitor_url, s.name AS site_name FROM incidents i LEFT JOIN monitors m ON m.id = i.monitor_id JOIN sites s ON s.id = i.site_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY i.detected_at DESC LIMIT 200`;
  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ incidents: rows.results });
});

incidentsRoutes.get("/incidents/:id", requireScope("monitoring:read"), async (c) => {
  const incident = await c.env.DB
    .prepare("SELECT i.*, m.url AS monitor_url, s.name AS site_name FROM incidents i LEFT JOIN monitors m ON m.id = i.monitor_id JOIN sites s ON s.id = i.site_id WHERE i.id = ?")
    .bind(c.req.param("id"))
    .first();
  if (!incident) return c.json({ error: "not_found" }, 404);
  const events = await c.env.DB.prepare("SELECT * FROM incident_events WHERE incident_id = ? ORDER BY created_at ASC LIMIT 200").bind(incident.id as string).all();
  const checks = incident.monitor_id
    ? await c.env.DB.prepare("SELECT checked_at, duration_ms, status_code, success, error_category, error_message FROM monitor_results WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 50").bind(incident.monitor_id as string).all()
    : { results: [] };
  return c.json({ incident, events: events.results, checks: checks.results });
});

const TRANSITIONS: Record<string, { status: string; column: string }> = {
  acknowledged: { status: "acknowledged", column: "acknowledged_at" },
  investigating: { status: "investigating", column: "" },
  resolved: { status: "resolved", column: "resolved_at" },
};

incidentsRoutes.post("/incidents/:id/:action", requireSession, async (c) => {
  const auth = getAuth(c);
  const action = c.req.param("action");
  const transition = TRANSITIONS[action];
  if (!transition) return c.json({ error: "invalid_action" }, 400);
  const incident = await c.env.DB.prepare("SELECT * FROM incidents WHERE id = ?").bind(c.req.param("id")).first<{ id: string; status: string; site_id: string }>();
  if (!incident) return c.json({ error: "not_found" }, 404);
  if (incident.status === "resolved") return c.json({ error: "incident_already_resolved" }, 409);
  const now = nowIso();
  const raw = await c.req.json().catch(() => null);
  const note = typeof raw?.note === "string" ? raw.note.slice(0, 2000) : null;
  if (transition.column) {
    await c.env.DB.prepare(`UPDATE incidents SET status = ?, ${transition.column} = ?, resolution_note = COALESCE(?, resolution_note) WHERE id = ?`).bind(transition.status, now, note, incident.id).run();
  } else {
    await c.env.DB.prepare("UPDATE incidents SET status = ?, resolution_note = COALESCE(?, resolution_note) WHERE id = ?").bind(transition.status, note, incident.id).run();
  }
  await c.env.DB
    .prepare("INSERT INTO incident_events (id, incident_id, type, message, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(newId("ince"), incident.id, action, note ?? `Incident ${action} by owner`, auth.ownerEmail, now)
    .run();
  await recordAudit({ db: c.env.DB, ownerId: auth.ownerId, category: "incidents", action: `incident_${action}`, actor: auth.ownerEmail, ip: clientIp(c), meta: { incidentId: incident.id } });
  return c.json({ ok: true });
});
