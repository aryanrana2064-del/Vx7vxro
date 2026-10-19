import type { CheckErrorCategory } from "@vxqor/shared";
import { dohResolve, parseTargetUrl, validateTarget, type DohResolver } from "./ssrf";

export interface CheckTarget {
  url: string;
  method: string;
  timeoutMs: number;
  maxRedirects: number;
  expectedStatusMin: number;
  expectedStatusMax: number;
}

export interface CheckOutcome {
  durationMs: number;
  statusCode: number | null;
  success: boolean;
  errorCategory: CheckErrorCategory;
  errorMessage: string | null;
  timedOut: boolean;
  redirectCount: number;
  finalUrl: string | null;
  resolvedIp: string | null;
  headers: Record<string, string> | null;
}

const MAX_BODY_BYTES = 256 * 1024;
const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "server",
  "content-type",
];

function outcome(partial: Partial<CheckOutcome> & { durationMs: number }): CheckOutcome {
  return {
    statusCode: null,
    success: false,
    errorCategory: "network",
    errorMessage: null,
    timedOut: false,
    redirectCount: 0,
    finalUrl: null,
    resolvedIp: null,
    headers: null,
    ...partial,
  };
}

async function readBounded(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength ?? 0;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return;
      }
    }
  } catch {
    // aborted/cancelled reads are fine; status was already recorded
  }
}

async function singleAttempt(
  target: CheckTarget,
  signal: AbortSignal,
): Promise<{ res: Response; redirectCount: number; finalUrl: string; hops: string[] } | { error: CheckErrorCategory; message: string }> {
  let currentUrl = target.url;
  let redirects = 0;
  const hops: string[] = [];
  for (;;) {
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: target.method,
        redirect: "manual",
        signal,
        headers: {
          "user-agent": "VXQOR-Monitor/1.0 (+https://vxqor.local/bot)",
          accept: "*/*",
        },
      });
    } catch (err) {
      const name = (err as Error)?.name ?? "";
      if (name === "TimeoutError" || name === "AbortError") return { error: "timeout", message: "request_timed_out" };
      return { error: "network", message: String((err as Error)?.message ?? err).slice(0, 300) };
    }
    const status = res.status;
    if (status >= 300 && status < 400) {
      const location = res.headers.get("location");
      if (redirects >= target.maxRedirects || !location) {
        return { res, redirectCount: redirects, finalUrl: currentUrl, hops };
      }
      let next: URL;
      try {
        next = new URL(location, currentUrl);
      } catch {
        return { error: "network", message: "invalid_redirect_location" };
      }
      const validation = await validateTarget(next.toString());
      if (!validation.ok) return { error: "ssrf_blocked", message: `redirect_blocked:${validation.reason}` };
      redirects += 1;
      hops.push(next.toString());
      currentUrl = next.toString();
      continue;
    }
    return { res, redirectCount: redirects, finalUrl: currentUrl, hops };
  }
}

export async function runCheck(target: CheckTarget, resolve: DohResolver = dohResolve): Promise<CheckOutcome> {
  const started = Date.now();
  const parsed = parseTargetUrl(target.url);
  if (parsed.error) {
    return outcome({ durationMs: 0, errorCategory: parsed.error === "scheme_not_allowed" ? "ssrf_blocked" : "network", errorMessage: parsed.error });
  }
  const validation = await validateTarget(target.url, resolve);
  if (!validation.ok) {
    return outcome({
      durationMs: Date.now() - started,
      errorCategory: validation.reason === "dns_resolution_failed" || validation.reason === "dns_no_records" ? "dns" : "ssrf_blocked",
      errorMessage: validation.reason ?? "blocked",
      resolvedIp: validation.ips[0] ?? null,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), target.timeoutMs);
  let lastError: CheckErrorCategory = "network";
  let lastMessage: string | null = null;
  let timedOut = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await singleAttempt(target, controller.signal);
    if ("error" in result) {
      lastError = result.error;
      lastMessage = result.message;
      timedOut = result.error === "timeout";
      // Retry with backoff only on transient transport failures.
      if ((result.error === "network" || result.error === "timeout") && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    }
    clearTimeout(timer);
    const durationMs = Date.now() - started;
    const headers: Record<string, string> = {};
    for (const h of SECURITY_HEADERS) {
      const v = result.res.headers.get(h);
      if (v) headers[h] = v.slice(0, 500);
    }
    await readBounded(result.res);
    const statusOk = result.res.status >= target.expectedStatusMin && result.res.status <= target.expectedStatusMax;
    return outcome({
      durationMs,
      statusCode: result.res.status,
      success: statusOk,
      errorCategory: statusOk ? "none" : "http_status",
      errorMessage: statusOk ? null : `unexpected_status_${result.res.status}`,
      timedOut: false,
      redirectCount: result.redirectCount,
      finalUrl: result.finalUrl,
      resolvedIp: validation.ips[0] ?? null,
      headers,
    });
  }
  clearTimeout(timer);
  return outcome({
    durationMs: Date.now() - started,
    errorCategory: lastError,
    errorMessage: lastMessage,
    timedOut,
    resolvedIp: validation.ips[0] ?? null,
  });
}
