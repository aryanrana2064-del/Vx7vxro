import { describe, expect, it } from "vitest";
import { bootstrapOwner, makeHarness } from "./harness";

describe("end-to-end integration", () => {
  it("applies migrations and exposes health", async () => {
    const h = makeHarness();
    const health = await h.json("GET", "/v1/health");
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    const tables = await h.d1.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
    const names = tables.results.map((t) => t.name);
    for (const expected of ["owners", "sessions", "sites", "monitors", "monitor_results", "incidents", "analytics_events", "api_keys", "audit_events", "scheduler_heartbeats"]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("runs the full owner journey: bootstrap, site, monitor, ingest, dashboard, exports", async () => {
    const h = makeHarness({ dev: true });
    const { cookie } = await bootstrapOwner(h);
    expect(cookie).toBeTruthy();

    const site = await h.json("POST", "/v1/sites", { name: "Marketing", environment: "production", domains: ["shop.example.com"] }, { cookie });
    expect(site.status).toBe(201);
    const { id: siteId, trackingId } = site.body.site;

    const monitor = await h.json("POST", "/v1/monitors", { siteId, url: "https://93.184.216.34/", intervalSeconds: 60 }, { cookie });
    expect(monitor.status, JSON.stringify(monitor.body)).toBe(201);

    await h.json("POST", `/v1/collect/${trackingId}/analytics`, { events: [{ v: 1, type: "pageview", path: "/", session: "sess-aaaaaaaaaa", screen: "desktop", dedupe: "e2e-1" }] }, { origin: "https://shop.example.com" });

    const summary = await h.json("GET", "/v1/dashboard/summary", { cookie });
    expect(summary.status).toBe(200);
    expect(summary.body.sites).toBe(1);
    expect(summary.body.analyticsConfigured).toBe(true);
    expect(summary.body.notificationsConfigured).toBe(false);

    const audit = await h.json("GET", "/v1/audit", { cookie });
    expect(audit.body.items.length).toBeGreaterThan(0);

    const csv = await h.fetch("/v1/exports?dataset=analytics&format=csv", { headers: { cookie: cookie as string, origin: "http://localhost:5173" } });
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text.split("\r\n")[0]).toContain("ts,event_type");
    expect(text).toContain("/");

    const json = await h.json("GET", "/v1/exports?dataset=monitoring&format=json", { cookie });
    expect(json.body.dataset).toBe("monitoring");
  });

  it("reports integrations as not configured until credentials are stored", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    const list = await h.json("GET", "/v1/integrations", { cookie });
    expect(list.body.integrations).toHaveLength(0);
    expect(list.body.encryptionConfigured).toBe(true);
    const gh = await h.json("GET", "/v1/integrations/github/data", { cookie });
    expect(gh.body.configured).toBe(false);
    const alerts = await h.json("GET", "/v1/integrations/alerts", { cookie });
    expect(alerts.body.webhookConfigured).toBe(false);
    const test = await h.json("POST", "/v1/integrations/alerts/test", {}, { cookie });
    expect(test.status).toBe(409);
    expect(test.body.reason).toBe("not_configured");
  });

  it("keeps security events and audit trail queryable with pagination", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    await h.json("POST", "/v1/auth/login", { email: "owner@example.com", password: "wrongwrongwrong1" });
    const unauth = await h.json("GET", "/v1/security/events?perPage=5");
    expect(unauth.status).toBe(401);
    const events = await h.json("GET", "/v1/security/events?perPage=5", { cookie });
    expect(events.status).toBe(200);
    expect(events.body.items.some((e: { kind: string }) => e.kind === "auth_failure")).toBe(true);
    expect(events.body.total).toBeGreaterThanOrEqual(1);
    const audit = await h.json("GET", "/v1/audit?page=1&perPage=2", { cookie });
    expect(audit.body.items.length).toBeLessThanOrEqual(2);
    expect(audit.body.page).toBe(1);
  });
});
