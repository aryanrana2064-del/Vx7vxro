import type { MonitorRow } from "@vxqor/shared";
import type { AppConfig } from "../env";
import { runCheck } from "../lib/checker";
import { log } from "../lib/log";
import { applyCheckResult } from "../lib/monitor-state";
import { sendAlert } from "../lib/notify";
import { pruneRateLimits } from "../lib/ratelimit";
import { recordSecurityEvent } from "../lib/security";
import { newId } from "../lib/ids";
import { validateTarget } from "../lib/ssrf";
import { nowIso, secondsAgoIso } from "../lib/time";

export interface SchedulerOptions {
  tlsProbe?: (host: string, port: number) => Promise<string | null>;
}

const REQUIRED_HEADERS = ["strict-transport-security", "x-content-type-options"];

async function heartbeat(db: D1Database, fields: { last_run_at?: string; last_success_at?: string; last_error?: string | null; increment?: boolean }) {
  const existing = await db.prepare("SELECT runs FROM scheduler_heartbeats WHERE job = 'monitor'").first<{ runs: number }>();
  const runs = (existing?.runs ?? 0) + (fields.increment ? 1 : 0);
  await db
    .prepare("INSERT OR REPLACE INTO scheduler_heartbeats (job, last_run_at, last_success_at, last_error, runs, cursor) VALUES ('monitor', ?, ?, ?, ?, ?)")
    .bind(
      fields.last_run_at ?? null,
      fields.last_success_at ?? null,
      fields.last_error === undefined ? null : fields.last_error,
      runs,
      null,
    )
    .run();
}

async function runSecurityChecks(db: D1Database, monitor: MonitorRow, headers: Record<string, string> | null, opts: SchedulerOptions, runtime: string) {
  const now = nowIso();
  const url = new URL(monitor.url);
  const isHttps = url.protocol === "https:";
  await db
    .prepare("INSERT INTO security_checks (id, site_id, monitor_id, kind, status, detail, checked_at) VALUES (?, ?, ?, 'https', ?, ?, ?)")
    .bind(newId("chk"), monitor.site_id, monitor.id, isHttps ? "pass" : "warn", isHttps ? null : "endpoint served over plain http", now)
    .run();

  if (headers) {
    const missing = REQUIRED_HEADERS.filter((h) => !headers[h]);
    await db
      .prepare("INSERT INTO security_checks (id, site_id, monitor_id, kind, status, detail, checked_at) VALUES (?, ?, ?, 'headers', ?, ?, ?)")
      .bind(newId("chk"), monitor.site_id, monitor.id, missing.length === 0 ? "pass" : "warn", missing.length ? `missing: ${missing.join(", ")}` : JSON.stringify(headers), now)
      .run();
  }

  const validation = await validateTarget(monitor.url).catch(() => null);
  if (validation?.ok && validation.ips.length > 0) {
    for (const ip of validation.ips.slice(0, 4)) {
      const existing = await db.prepare("SELECT id FROM dns_records WHERE domain = ? AND record_type = 'A_OR_AAAA' AND value = ?").bind(url.hostname, ip).first<{ id: string }>();
      if (existing) {
        await db.prepare("UPDATE dns_records SET last_seen_at = ? WHERE id = ?").bind(now, existing.id).run();
      } else {
        const prior = await db.prepare("SELECT value, first_seen_at FROM dns_records WHERE domain = ? AND record_type = 'A_OR_AAAA' ORDER BY first_seen_at DESC LIMIT 1").bind(url.hostname).first<{ value: string; first_seen_at: string }>();
        await db.prepare("INSERT INTO dns_records (id, domain, record_type, value, first_seen_at, last_seen_at) VALUES (?, ?, 'A_OR_AAAA', ?, ?, ?)").bind(newId("dns"), url.hostname, ip, now, now).run();
        if (prior) {
          await recordSecurityEvent({ db, kind: "dns_change", severity: "warn", title: `DNS change detected for ${url.hostname}`, detail: `${prior.value} -> ${ip}`, siteId: monitor.site_id });
        }
      }
    }
    await db.prepare("INSERT INTO security_checks (id, site_id, monitor_id, kind, status, detail, checked_at) VALUES (?, ?, ?, 'dns', 'pass', ?, ?)").bind(newId("chk"), monitor.site_id, monitor.id, JSON.stringify(validation.ips.slice(0, 4)), now).run();
  }

  const recentTls = await db.prepare("SELECT checked_at FROM security_checks WHERE monitor_id = ? AND kind = 'ssl_expiry' ORDER BY checked_at DESC LIMIT 1").bind(monitor.id).first<{ checked_at: string }>();
  const tlsDue = !recentTls || Date.now() - new Date(recentTls.checked_at).getTime() > 24 * 3600_000;
  if (tlsDue && isHttps) {
    if (opts.tlsProbe) {
      const expiry = await opts.tlsProbe(url.hostname, 443).catch(() => null);
      const daysLeft = expiry ? Math.floor((new Date(expiry).getTime() - Date.now()) / 86400_000) : null;
      const status = expiry === null ? "fail" : daysLeft !== null && daysLeft < 14 ? "warn" : "pass";
      await db.prepare("INSERT INTO security_checks (id, site_id, monitor_id, kind, status, detail, checked_at) VALUES (?, ?, ?, 'ssl_expiry', ?, ?, ?)").bind(newId("chk"), monitor.site_id, monitor.id, status, expiry ? `expires ${expiry} (${daysLeft} days)` : "tls handshake failed", now).run();
      if (status !== "pass") {
        await recordSecurityEvent({ db, kind: "ssl_expiry", severity: status === "fail" ? "critical" : "warn", title: `SSL certificate ${status === "fail" ? "unreachable" : "expiring soon"}: ${url.hostname}`, detail: expiry ?? null, siteId: monitor.site_id });
      }
    } else {
      await db.prepare("INSERT INTO security_checks (id, site_id, monitor_id, kind, status, detail, checked_at) VALUES (?, ?, ?, 'ssl_expiry', 'unavailable', ?, ?)").bind(newId("chk"), monitor.site_id, monitor.id, "Workers runtime cannot inspect TLS certificates; run the Node scheduler for cert expiry checks", now).run();
    }
  }
}

async function detectMissedChecks(db: D1Database, monitors: MonitorRow[]) {
  const now = Date.now();
  for (const m of monitors) {
    if (!m.last_check_at) continue;
    const overdueMs = now - new Date(m.last_check_at).getTime() - (m.interval_seconds * 2 + 600) * 1000;
    if (overdueMs <= 0) continue;
    const recent = await db.prepare("SELECT id FROM security_events WHERE kind = 'missed_checks' AND detail LIKE ? AND created_at > ?").bind(`%${m.id}%`, secondsAgoIso(3600)).first();
    if (!recent) {
      await recordSecurityEvent({ db, kind: "missed_checks", severity: "warn", title: `Monitoring lag: ${m.url} overdue`, detail: `monitor ${m.id} last check ${m.last_check_at}; scheduler may be throttled or idle`, siteId: m.site_id });
    }
  }
}

async function retentionCleanup(db: D1Database, cfg: AppConfig) {
  const cutoffs: [string, number][] = Object.entries(cfg.retention);
  for (const [table, days] of cutoffs) {
    const allowed = new Set(["monitor_results", "analytics_events", "perf_events", "audit_events", "security_events", "api_usage_hourly"]);
    if (!allowed.has(table)) continue;
    const cutoff = secondsAgoIso(days * 86400);
    const column = table === "monitor_results" ? "checked_at" : table === "api_usage_hourly" ? "hour" : table === "audit_events" || table === "security_events" ? "created_at" : "ts";
    try {
      const res = await db.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).bind(cutoff).run();
      if ((res.meta.changes ?? 0) > 0) log("info", "retention_cleanup", { table, deleted: res.meta.changes });
    } catch (err) {
      log("warn", "retention_cleanup_failed", { table, message: String((err as Error).message) });
    }
  }
  await pruneRateLimits(db, secondsAgoIso(86400));
}

export async function runScheduler(env: { DB: D1Database }, cfg: AppConfig, opts: SchedulerOptions = {}): Promise<{ checked: number }> {
  const db = env.DB;
  const now = nowIso();
  await heartbeat(db, { last_run_at: now, increment: true });
  try {
    const due = await db
      .prepare("SELECT m.* FROM monitors m JOIN sites s ON s.id = m.site_id WHERE m.enabled = 1 AND s.disabled_at IS NULL AND (m.last_check_at IS NULL OR m.last_check_at <= ?) ORDER BY m.last_check_at ASC LIMIT ?")
      .bind(secondsAgoIso(0), cfg.maxChecksPerRun)
      .all<MonitorRow>();
    // Filter to actually-due monitors in code (interval per monitor).
    const dueNow = due.results.filter((m) => !m.last_check_at || Date.now() - new Date(m.last_check_at).getTime() >= m.interval_seconds * 1000);

    let checked = 0;
    for (const monitor of dueNow) {
      const out = await runCheck({
        url: monitor.url,
        method: monitor.method,
        timeoutMs: monitor.timeout_ms,
        maxRedirects: monitor.max_redirects,
        expectedStatusMin: monitor.expected_status_min,
        expectedStatusMax: monitor.expected_status_max,
      });
      await applyCheckResult(db, monitor, out, async (event) => {
        const result = await sendAlert(db, {
          type: event.type === "opened" ? "incident_opened" : "incident_resolved",
          title: event.type === "opened" ? `VXQOR: ${monitor.url} is DOWN` : `VXQOR: ${monitor.url} recovered`,
          detail: event.type === "opened" ? `Incident ${event.incidentId}` : `Incident ${event.incidentId} resolved`,
        });
        if (!result.delivered && result.reason === "not_configured") {
          log("info", "alert_not_configured", { incidentId: event.incidentId });
        }
      });
      await runSecurityChecks(db, monitor, out.headers, opts, cfg.runtime);
      checked += 1;
    }

    const allMonitors = await db.prepare("SELECT * FROM monitors WHERE enabled = 1").all<MonitorRow>();
    await detectMissedChecks(db, allMonitors.results);

    const lastCleanup = await db.prepare("SELECT cursor FROM scheduler_heartbeats WHERE job = 'retention'").first<{ cursor: string | null }>();
    if (!lastCleanup?.cursor || Date.now() - new Date(lastCleanup.cursor).getTime() > 3600_000) {
      await retentionCleanup(db, cfg);
      await db.prepare("INSERT OR REPLACE INTO scheduler_heartbeats (job, last_run_at, last_success_at, last_error, runs, cursor) VALUES ('retention', ?, ?, NULL, 0, ?)").bind(now, now, now).run();
    }

    await heartbeat(db, { last_run_at: now, last_success_at: now, last_error: null });
    log("info", "scheduler_run", { checked, due: dueNow.length });
    return { checked };
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 500);
    await heartbeat(db, { last_run_at: now, last_error: message });
    log("error", "scheduler_failed", { message });
    return { checked: 0 };
  }
}
