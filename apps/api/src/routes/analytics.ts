import { Hono } from "hono";
import type { AppEnv } from "../env";
import { rangeSchema } from "@vxqor/shared";
import { bucketMs, floorToBucket, percentile, rangeBounds } from "../lib/time";
import { requireScope } from "../middleware/auth";

export const analyticsRoutes = new Hono<{ Bindings: AppEnv }>();

analyticsRoutes.get("/sites/:id/analytics", requireScope("analytics:read"), async (c) => {
  const siteId = c.req.param("id");
  const range = rangeSchema.parse(c.req.query("range") ?? "7d");
  const { from, to } = rangeBounds(range);
  const site = await c.env.DB.prepare("SELECT id FROM sites WHERE id = ?").bind(siteId).first();
  if (!site) return c.json({ error: "not_found" }, 404);

  const totals = await c.env.DB
    .prepare(
      "SELECT COUNT(*) AS pageviews, COUNT(DISTINCT session_hash) AS sessions, COUNT(DISTINCT visitor_hash) AS visitors FROM analytics_events WHERE site_id = ? AND ts >= ? AND ts <= ? AND event_type = 'pageview'",
    )
    .bind(siteId, from, to)
    .first<{ pageviews: number; sessions: number; visitors: number }>();

  const paths = await c.env.DB
    .prepare("SELECT path, COUNT(*) AS count FROM analytics_events WHERE site_id = ? AND ts >= ? AND ts <= ? AND event_type = 'pageview' GROUP BY path ORDER BY count DESC LIMIT 10")
    .bind(siteId, from, to)
    .all<{ path: string; count: number }>();

  const referrers = await c.env.DB
    .prepare("SELECT COALESCE(referrer_domain, referrer_category) AS referrer, COUNT(*) AS count FROM analytics_events WHERE site_id = ? AND ts >= ? AND ts <= ? AND event_type = 'pageview' AND referrer_category <> 'internal' GROUP BY referrer ORDER BY count DESC LIMIT 10")
    .bind(siteId, from, to)
    .all<{ referrer: string; count: number }>();

  const devices = await c.env.DB
    .prepare("SELECT device AS label, COUNT(*) AS count FROM analytics_events WHERE site_id = ? AND ts >= ? AND ts <= ? AND event_type = 'pageview' GROUP BY device ORDER BY count DESC")
    .bind(siteId, from, to)
    .all<{ label: string; count: number }>();

  const rows = await c.env.DB
    .prepare("SELECT ts FROM analytics_events WHERE site_id = ? AND ts >= ? AND ts <= ? AND event_type = 'pageview' LIMIT 20000")
    .bind(siteId, from, to)
    .all<{ ts: string }>();
  const bucket = bucketMs(range);
  const series = new Map<number, number>();
  for (const r of rows.results) {
    const key = floorToBucket(new Date(r.ts).getTime(), bucket);
    series.set(key, (series.get(key) ?? 0) + 1);
  }
  const timeseries = [...series.entries()].sort((a, b) => a[0] - b[0]).map(([ts, value]) => ({ ts: new Date(ts).toISOString(), value }));

  return c.json({
    pageviews: totals?.pageviews ?? 0,
    sessions: totals?.sessions ?? 0,
    estimatedUniqueVisitors: totals?.visitors ?? 0,
    topPaths: paths.results,
    topReferrers: referrers.results,
    deviceBreakdown: devices.results,
    timeseries,
    measurementNote:
      "Unique visitors are estimates derived from truncated-IP + user-agent fingerprints per day. Browser restrictions, bot traffic, consent choices and blocked scripts affect measurement.",
  });
});

analyticsRoutes.get("/sites/:id/performance", requireScope("performance:read"), async (c) => {
  const siteId = c.req.param("id");
  const range = rangeSchema.parse(c.req.query("range") ?? "7d");
  const { from, to } = rangeBounds(range);
  const rows = await c.env.DB
    .prepare("SELECT metric, value, path, deployment_id FROM perf_events WHERE site_id = ? AND ts >= ? AND ts <= ? LIMIT 20000")
    .bind(siteId, from, to)
    .all<{ metric: string; value: number; path: string; deployment_id: string | null }>();
  const byMetric = new Map<string, number[]>();
  const byPath = new Map<string, number[]>();
  const byDep = new Map<string, Map<string, number[]>>();
  for (const r of rows.results) {
    const m = byMetric.get(r.metric) ?? [];
    m.push(r.value);
    byMetric.set(r.metric, m);
    if (r.metric === "lcp" || r.metric === "ttfb") {
      const p = byPath.get(r.path) ?? [];
      p.push(r.value);
      byPath.set(r.path, p);
    }
    if (r.deployment_id) {
      const depMap = byDep.get(r.deployment_id) ?? new Map();
      const arr = depMap.get(r.metric) ?? [];
      arr.push(r.value);
      depMap.set(r.metric, arr);
      byDep.set(r.deployment_id, depMap);
    }
  }
  const metrics = [...byMetric.entries()].map(([metric, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { metric, p50: percentile(sorted, 50), p75: percentile(sorted, 75), p95: percentile(sorted, 95), count: sorted.length };
  });
  const slowestPaths = [...byPath.entries()]
    .map(([path, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { path, p95: percentile(sorted, 95), count: sorted.length };
    })
    .sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0))
    .slice(0, 10);

  const monitorLatencyRows = await c.env.DB
    .prepare("SELECT r.checked_at, r.duration_ms FROM monitor_results r JOIN monitors m ON m.id = r.monitor_id WHERE m.site_id = ? AND r.checked_at >= ? AND r.success = 1 ORDER BY r.checked_at ASC LIMIT 5000")
    .bind(siteId, from)
    .all<{ checked_at: string; duration_ms: number }>();
  const bucket = bucketMs(range);
  const latSeries = new Map<number, number[]>();
  for (const r of monitorLatencyRows.results) {
    const key = floorToBucket(new Date(r.checked_at).getTime(), bucket);
    const arr = latSeries.get(key) ?? [];
    arr.push(r.duration_ms);
    latSeries.set(key, arr);
  }
  const monitorLatency = [...latSeries.entries()].sort((a, b) => a[0] - b[0]).map(([ts, v]) => ({ ts: new Date(ts).toISOString(), value: percentile(v.sort((a, b) => a - b), 50) ?? 0 }));

  const depLabels = byDep.size
    ? await c.env.DB.prepare("SELECT id, COALESCE(commit_sha, provider_ref, id) AS label FROM deployments WHERE site_id = ?").bind(siteId).all<{ id: string; label: string }>()
    : { results: [] };
  const labelById = new Map(depLabels.results.map((d) => [d.id, d.label]));
  const byDeployment = [...byDep.entries()].flatMap(([depId, metricMap]) =>
    [...metricMap.entries()].map(([metric, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { deployment: labelById.get(depId) ?? depId, metric, p75: percentile(sorted, 75), count: sorted.length };
    }),
  );

  return c.json({ samples: rows.results.length, metrics, slowestPaths, monitorLatency, byDeployment });
});

analyticsRoutes.get("/sites/:id/errors", requireScope("errors:read"), async (c) => {
  const siteId = c.req.param("id");
  const status = c.req.query("status") ?? "open";
  const rows = await c.env.DB
    .prepare("SELECT * FROM error_events WHERE site_id = ? AND status = ? ORDER BY last_seen_at DESC LIMIT 200")
    .bind(siteId, status)
    .all();
  return c.json({ errors: rows.results });
});

analyticsRoutes.patch("/errors/:id", requireScope("errors:read"), async (c) => {
  const status = c.req.query("status");
  if (status !== "open" && status !== "resolved" && status !== "ignored") return c.json({ error: "invalid_status" }, 400);
  const res = await c.env.DB.prepare("UPDATE error_events SET status = ? WHERE id = ?").bind(status, c.req.param("id")).run();
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

analyticsRoutes.get("/dashboard/summary", requireScope("monitoring:read"), async (c) => {
  const db = c.env.DB;
  const sites = await db.prepare("SELECT COUNT(*) AS n FROM sites WHERE disabled_at IS NULL").first<{ n: number }>();
  const monitors = await db.prepare("SELECT status, COUNT(*) AS n FROM monitors WHERE enabled = 1 GROUP BY status").all<{ status: string; n: number }>();
  const counts: Record<string, number> = {};
  for (const m of monitors.results) counts[m.status] = m.n;
  const incidents = await db.prepare("SELECT status, COUNT(*) AS n FROM incidents WHERE status <> 'resolved' GROUP BY status").all<{ status: string; n: number }>();
  const openIncidents = incidents.results.filter((i) => i.status === "detected").reduce((a, b) => a + b.n, 0);
  const ackIncidents = incidents.results.filter((i) => i.status !== "detected").reduce((a, b) => a + b.n, 0);
  const lastCheck = await db.prepare("SELECT MAX(checked_at) AS t FROM monitor_results").first<{ t: string | null }>();
  const heartbeat = await db.prepare("SELECT last_run_at, last_success_at FROM scheduler_heartbeats WHERE job = 'monitor'").first<{ last_run_at: string | null; last_success_at: string | null }>();
  const lastIngest = await db.prepare("SELECT MAX(ts) AS t FROM analytics_events").first<{ t: string | null }>();
  const uptimeRow = await db
    .prepare("SELECT COUNT(*) AS total, SUM(success) AS ok FROM monitor_results WHERE checked_at >= ?")
    .bind(new Date(Date.now() - 7 * 86400_000).toISOString())
    .first<{ total: number; ok: number | null }>();
  const latRows = await db
    .prepare("SELECT duration_ms FROM monitor_results WHERE checked_at >= ? AND success = 1 ORDER BY duration_ms ASC LIMIT 5000")
    .bind(new Date(Date.now() - 7 * 86400_000).toISOString())
    .all<{ duration_ms: number }>();
  const lats = latRows.results.map((r) => r.duration_ms);
  const deployments = await db.prepare("SELECT * FROM deployments ORDER BY created_at DESC LIMIT 5").all();
  const errors = await db.prepare("SELECT * FROM error_events WHERE status = 'open' ORDER BY last_seen_at DESC LIMIT 5").all();
  const analyticsCount = await db.prepare("SELECT COUNT(*) AS n FROM analytics_events").first<{ n: number }>();
  const alertCfg = await db.prepare("SELECT value FROM settings WHERE key = 'alert_webhook_url'").first<{ value: string }>();
  const schedulerStale = !heartbeat?.last_success_at || Date.now() - new Date(heartbeat.last_success_at).getTime() > 20 * 60_000;
  return c.json({
    sites: sites?.n ?? 0,
    monitorsUp: counts["up"] ?? 0,
    monitorsDegraded: counts["degraded"] ?? 0,
    monitorsDown: counts["down"] ?? 0,
    monitorsUnknown: counts["unknown"] ?? 0,
    openIncidents,
    acknowledgedIncidents: ackIncidents,
    lastCheckAt: lastCheck?.t ?? null,
    schedulerStale,
    schedulerLastRunAt: heartbeat?.last_run_at ?? null,
    lastIngestionAt: lastIngest?.t ?? null,
    uptimePct: uptimeRow && uptimeRow.total > 0 ? ((uptimeRow.ok ?? 0) / uptimeRow.total) * 100 : null,
    uptimeWindowDays: 7,
    responseP50: percentile(lats, 50),
    responseP95: percentile(lats, 95),
    recentDeployments: deployments.results,
    recentErrors: errors.results,
    analyticsConfigured: (analyticsCount?.n ?? 0) > 0,
    notificationsConfigured: Boolean(alertCfg?.value),
  });
});
