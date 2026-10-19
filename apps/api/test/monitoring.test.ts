import { afterEach, describe, expect, it, vi } from "vitest";
import { runCheck } from "../src/lib/checker";
import { applyCheckResult } from "../src/lib/monitor-state";
import type { MonitorRow } from "@vxqor/shared";
import { bootstrapOwner, makeHarness } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: () => Response) {
  vi.stubGlobal("fetch", vi.fn(async () => response()));
}

const monitor = (over: Partial<MonitorRow> = {}): MonitorRow => ({
  id: "mon_test",
  site_id: "site_test",
  url: "https://example.com/",
  method: "GET",
  interval_seconds: 300,
  timeout_ms: 5000,
  max_redirects: 2,
  failure_threshold: 2,
  expected_status_min: 200,
  expected_status_max: 399,
  slow_threshold_ms: 3000,
  enabled: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  consecutive_failures: 0,
  last_check_at: null,
  last_success_at: null,
  status: "unknown",
  ...over,
});

describe("monitoring engine", () => {
  it("classifies successful and failing checks", async () => {
    stubFetch(() => new Response("ok", { status: 200, headers: { "x-content-type-options": "nosniff" } }));
    const ok = await runCheck({ url: "https://93.184.216.34/", method: "GET", timeoutMs: 5000, maxRedirects: 2, expectedStatusMin: 200, expectedStatusMax: 399 }, async () => ["93.184.216.34"]);
    expect(ok.success).toBe(true);
    expect(ok.statusCode).toBe(200);

    stubFetch(() => new Response("boom", { status: 500 }));
    const fail = await runCheck({ url: "https://93.184.216.34/", method: "GET", timeoutMs: 5000, maxRedirects: 2, expectedStatusMin: 200, expectedStatusMax: 399 }, async () => ["93.184.216.34"]);
    expect(fail.success).toBe(false);
    expect(fail.errorCategory).toBe("http_status");
  });

  it("blocks checks to loopback and metadata endpoints before any request", async () => {
    const spy = vi.fn(async () => new Response("x"));
    vi.stubGlobal("fetch", spy);
    const loop = await runCheck({ url: "http://127.0.0.1:8080/admin", method: "GET", timeoutMs: 2000, maxRedirects: 0, expectedStatusMin: 200, expectedStatusMax: 399 });
    expect(loop.success).toBe(false);
    expect(loop.errorCategory).toBe("ssrf_blocked");
    const meta = await runCheck({ url: "http://169.254.169.254/latest/meta-data/", method: "GET", timeoutMs: 2000, maxRedirects: 0, expectedStatusMin: 200, expectedStatusMax: 399 });
    expect(meta.errorCategory).toBe("ssrf_blocked");
    expect(spy).not.toHaveBeenCalled();
  });

  it("validates redirect hops and enforces the redirect limit", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls += 1;
        if (calls === 1) return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8080/internal" } });
        return new Response("ok", { status: 200 });
      }),
    );
    const res = await runCheck({ url: "https://93.184.216.34/", method: "GET", timeoutMs: 5000, maxRedirects: 2, expectedStatusMin: 200, expectedStatusMax: 399 }, async (host) => (host.includes("127.") ? ["127.0.0.1"] : ["93.184.216.34"]));
    expect(res.success).toBe(false);
    expect(res.errorCategory).toBe("ssrf_blocked");
  });

  it("opens an incident after the failure threshold and resolves it on recovery", async () => {
    const h = makeHarness();
    await h.d1.prepare("INSERT INTO sites (id, name, environment, tracking_id, created_at, updated_at) VALUES ('site_test','t','production','vxq-test',?,?)").bind(new Date().toISOString(), new Date().toISOString()).run();
    await h.d1.prepare("INSERT INTO monitors (id, site_id, url, created_at, updated_at) VALUES ('mon_test','site_test','https://example.com/',?,?)").bind(new Date().toISOString(), new Date().toISOString()).run();
    let m = monitor();
    const fail = { durationMs: 100, statusCode: 500, success: false, errorCategory: "http_status" as const, errorMessage: "unexpected_status_500", timedOut: false, redirectCount: 0, finalUrl: m.url, resolvedIp: "93.184.216.34", headers: null };
    const first = await applyCheckResult(h.env.DB, m, fail);
    expect(first.incidentOpened).toBeNull();
    m = monitor({ consecutive_failures: 1, status: "degraded" });
    const second = await applyCheckResult(h.env.DB, m, fail);
    expect(second.incidentOpened).toBeTruthy();
    expect(second.monitorStatus).toBe("down");
    // duplicate suppression
    m = monitor({ consecutive_failures: 2, status: "down" });
    const third = await applyCheckResult(h.env.DB, m, fail);
    expect(third.incidentOpened).toBeNull();
    const openCount = await h.d1.prepare("SELECT COUNT(*) AS n FROM incidents WHERE status <> 'resolved'").first<{ n: number }>();
    expect(openCount?.n).toBe(1);
    // recovery
    m = monitor({ consecutive_failures: 3, status: "down" });
    const recovered = await applyCheckResult(h.env.DB, m, { ...fail, success: true, statusCode: 200, errorCategory: "none", errorMessage: null });
    expect(recovered.incidentResolved).toBeTruthy();
    const events = await h.d1.prepare("SELECT type FROM incident_events ORDER BY created_at").all<{ type: string }>();
    expect(events.results.map((e) => e.type)).toEqual(["detected", "resolved"]);
  });

  it("rejects unsafe monitor targets at creation and requires auth", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    const site = await h.json("POST", "/v1/sites", { name: "Prod", domains: ["example.com"] }, { cookie });
    const siteId = site.body.site.id as string;
    const unsafe = await h.json("POST", "/v1/monitors", { siteId, url: "http://127.0.0.1:8080/" }, { cookie });
    expect(unsafe.status).toBe(400);
    expect(unsafe.body.error).toBe("target_rejected");
    const noAuth = await h.json("POST", "/v1/monitors", { siteId, url: "https://example.com/" });
    expect(noAuth.status).toBe(401);
    const safe = await h.json("POST", "/v1/monitors", { siteId, url: "https://example.com/" }, { cookie });
    expect(safe.status).toBe(201);
    const dup = await h.json("POST", "/v1/monitors", { siteId, url: "https://example.com/" }, { cookie });
    expect(dup.status).toBe(409);
  });

  it("runs the scheduler against stubbed network and stores results + heartbeat", async () => {
    const h = makeHarness({ dev: true });
    const { cookie } = await bootstrapOwner(h);
    const site = await h.json("POST", "/v1/sites", { name: "Prod", domains: ["example.com"] }, { cookie });
    const mon = await h.json("POST", "/v1/monitors", { siteId: site.body.site.id, url: "https://93.184.216.34/" }, { cookie });
    expect(mon.status).toBe(201);
    stubFetch(() => new Response("ok", { status: 200 }));
    const run = await h.json("POST", "/v1/dev/scheduler-run", {}, { cookie });
    expect(run.status).toBe(200);
    expect(run.body.checked).toBe(1);
    const results = await h.d1.prepare("SELECT success, status_code FROM monitor_results").all<{ success: number; status_code: number }>();
    expect(results.results).toHaveLength(1);
    expect(results.results[0]?.success).toBe(1);
    const hb = await h.d1.prepare("SELECT last_success_at FROM scheduler_heartbeats WHERE job = 'monitor'").first<{ last_success_at: string | null }>();
    expect(hb?.last_success_at).toBeTruthy();
    const checks = await h.d1.prepare("SELECT kind, status FROM security_checks").all<{ kind: string; status: string }>();
    expect(checks.results.map((c) => c.kind)).toContain("headers");
  });
});
