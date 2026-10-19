import type { MonitorRow } from "@vxqor/shared";
import type { CheckOutcome } from "./checker";
import { newId } from "./ids";
import { recordSecurityEvent } from "./security";
import { nowIso } from "./time";

export interface StateUpdateResult {
  monitorStatus: string;
  incidentOpened: string | null;
  incidentResolved: string | null;
}

/**
 * Persists a check result and advances monitor state + incident lifecycle.
 * Duplicate incidents are suppressed: at most one open incident per monitor.
 */
export async function applyCheckResult(
  db: D1Database,
  monitor: MonitorRow,
  out: CheckOutcome,
  notify?: (event: { type: "opened" | "resolved"; monitor: MonitorRow; incidentId: string }) => Promise<void>,
): Promise<StateUpdateResult> {
  const now = nowIso();
  await db
    .prepare(
      "INSERT INTO monitor_results (id, monitor_id, checked_at, duration_ms, status_code, success, error_category, error_message, timed_out, redirect_count, final_url, resolved_ip, tls_expiry, headers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      newId("res"),
      monitor.id,
      now,
      out.durationMs,
      out.statusCode,
      out.success ? 1 : 0,
      out.errorCategory,
      out.errorMessage,
      out.timedOut ? 1 : 0,
      out.redirectCount,
      out.finalUrl,
      out.resolvedIp,
      null,
      out.headers ? JSON.stringify(out.headers) : null,
    )
    .run();

  const consecutiveFailures = out.success ? 0 : monitor.consecutive_failures + 1;
  const slow = out.success && out.durationMs > monitor.slow_threshold_ms;
  let status: MonitorRow["status"] = out.success ? (slow ? "degraded" : "up") : "unknown";
  if (!out.success && consecutiveFailures >= monitor.failure_threshold) status = "down";
  else if (!out.success) status = monitor.status === "down" ? "down" : "degraded";

  await db
    .prepare(
      "UPDATE monitors SET consecutive_failures = ?, last_check_at = ?, last_success_at = ?, status = ?, updated_at = ? WHERE id = ?",
    )
    .bind(consecutiveFailures, now, out.success ? now : monitor.last_success_at, status, now, monitor.id)
    .run();

  let incidentOpened: string | null = null;
  let incidentResolved: string | null = null;

  const open = await db
    .prepare("SELECT id, status FROM incidents WHERE monitor_id = ? AND status <> 'resolved' ORDER BY detected_at DESC LIMIT 1")
    .bind(monitor.id)
    .first<{ id: string; status: string }>();

  if (status === "down" && !open) {
    const incidentId = newId("inc");
    await db
      .prepare("INSERT INTO incidents (id, site_id, monitor_id, status, trigger_condition, detected_at) VALUES (?, ?, ?, 'detected', ?, ?)")
      .bind(incidentId, monitor.site_id, monitor.id, `${monitor.failure_threshold} consecutive failed checks; last error: ${out.errorMessage ?? out.errorCategory}`, now)
      .run();
    await db
      .prepare("INSERT INTO incident_events (id, incident_id, type, message, actor, created_at) VALUES (?, ?, 'detected', ?, 'system', ?)")
      .bind(newId("ince"), incidentId, `Monitor ${monitor.url} failed ${consecutiveFailures} consecutive checks (${out.errorCategory}${out.statusCode ? ` status ${out.statusCode}` : ""})`, now)
      .run();
    await recordSecurityEvent({ db, kind: "incident_opened", severity: "critical", title: `Endpoint down: ${monitor.url}`, detail: out.errorMessage, siteId: monitor.site_id });
    incidentOpened = incidentId;
    await notify?.({ type: "opened", monitor, incidentId });
  } else if (open && out.success && monitor.status === "down") {
    await db
      .prepare("UPDATE incidents SET status = 'resolved', resolved_at = ?, resolution_note = 'auto-resolved after successful check' WHERE id = ?")
      .bind(now, open.id)
      .run();
    await db
      .prepare("INSERT INTO incident_events (id, incident_id, type, message, actor, created_at) VALUES (?, ?, 'resolved', ?, 'system', ?)")
      .bind(newId("ince"), open.id, `Monitor ${monitor.url} recovered (status ${out.statusCode}, ${out.durationMs}ms)`, now)
      .run();
    await recordSecurityEvent({ db, kind: "incident_resolved", severity: "info", title: `Endpoint recovered: ${monitor.url}`, detail: null, siteId: monitor.site_id });
    incidentResolved = open.id;
    await notify?.({ type: "resolved", monitor, incidentId: open.id });
  }

  return { monitorStatus: status, incidentOpened, incidentResolved };
}
