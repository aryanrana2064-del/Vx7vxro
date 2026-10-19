import { hmacSha256Hex } from "./crypto";
import { log } from "./log";
import { nowIso } from "./time";

export interface AlertPayload {
  type: string;
  title: string;
  detail?: string | null;
  url?: string | null;
}

export interface AlertResult {
  delivered: boolean;
  reason?: string;
}

export async function sendAlert(db: D1Database, payload: AlertPayload): Promise<AlertResult> {
  const row = await db.prepare("SELECT key, value FROM settings WHERE key IN ('alert_webhook_url','alert_webhook_secret')").all<{ key: string; value: string }>();
  const settings = Object.fromEntries(row.results.map((r) => [r.key, r.value]));
  const url = settings["alert_webhook_url"];
  if (!url) return { delivered: false, reason: "not_configured" };
  const body = JSON.stringify({ ...payload, ts: nowIso(), source: "vxqor" });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings["alert_webhook_secret"]) {
    headers["x-vxqor-signature"] = await hmacSha256Hex(settings["alert_webhook_secret"], body);
  }
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      log("warn", "alert_webhook_non_2xx", { status: res.status });
      return { delivered: false, reason: `http_${res.status}` };
    }
    return { delivered: true };
  } catch (err) {
    log("warn", "alert_webhook_failed", { message: String((err as Error).message) });
    return { delivered: false, reason: "network_error" };
  }
}
