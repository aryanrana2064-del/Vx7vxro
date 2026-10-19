import { describe, expect, it } from "vitest";
import { bootstrapOwner, makeHarness } from "./harness";

async function setupSite(h: ReturnType<typeof makeHarness>) {
  const { cookie } = await bootstrapOwner(h);
  const site = await h.json("POST", "/v1/sites", { name: "Prod", domains: ["example.com"] }, { cookie });
  return { cookie, trackingId: site.body.site.trackingId as string, siteId: site.body.site.id as string };
}

describe("analytics ingestion and queries", () => {
  it("accepts valid batches, dedupes, and rejects bad payloads", async () => {
    const h = makeHarness();
    const { trackingId } = await setupSite(h);
    const batch = {
      events: [
        { v: 1, type: "pageview", path: "/", referrer: "https://www.google.com/search?q=x", session: "sess-abcdef12", screen: "desktop", dedupe: "d1" },
        { v: 1, type: "pageview", path: "/about", session: "sess-abcdef12", screen: "mobile", dedupe: "d2" },
      ],
    };
    const res = await h.json("POST", `/v1/collect/${trackingId}/analytics`, batch, { origin: "https://example.com" });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(2);
    const again = await h.json("POST", `/v1/collect/${trackingId}/analytics`, batch, { origin: "https://example.com" });
    expect(again.body.accepted).toBe(0);
    expect(again.body.rejected).toBe(2);
    const bad = await h.json("POST", `/v1/collect/${trackingId}/analytics`, { events: [{ v: 2, type: "pageview", path: "nope" }] }, { origin: "https://example.com" });
    expect(bad.status).toBe(400);
  });

  it("rejects ingestion from origins outside the site allowlist", async () => {
    const h = makeHarness();
    const { trackingId } = await setupSite(h);
    const res = await h.json("POST", `/v1/collect/${trackingId}/analytics`, { events: [{ v: 1, type: "pageview", path: "/", session: "sess-abcdef12" }] }, { origin: "https://attacker.example" });
    expect(res.status).toBe(403);
  });

  it("rate limits abusive ingestion", async () => {
    const h = makeHarness();
    const { trackingId } = await setupSite(h);
    let last = 200;
    for (let i = 0; i < 130; i++) {
      const res = await h.json("POST", `/v1/collect/${trackingId}/analytics`, { events: [{ v: 1, type: "pageview", path: `/p${i}`, session: "sess-abcdef12", dedupe: `x${i}` }] }, { origin: "https://example.com", headers: { "x-forwarded-for": "203.0.113.7" } });
      last = res.status;
      if (res.status === 429) break;
    }
    expect(last).toBe(429);
  });

  it("aggregates pageviews, sessions, referrers and devices", async () => {
    const h = makeHarness();
    const { cookie, trackingId, siteId } = await setupSite(h);
    for (let i = 0; i < 5; i++) {
      await h.json("POST", `/v1/collect/${trackingId}/analytics`, {
        events: [
          { v: 1, type: "pageview", path: i % 2 ? "/a" : "/b", referrer: i % 2 ? "https://www.google.com/" : "https://twitter.com/x", session: `s${i}-aaaaaaaa`, screen: i % 2 ? "mobile" : "desktop", dedupe: `agg${i}` },
        ],
      }, { origin: "https://example.com" });
    }
    const overview = await h.json("GET", `/v1/sites/${siteId}/analytics?range=24h`, { cookie });
    expect(overview.status).toBe(200);
    expect(overview.body.pageviews).toBe(5);
    expect(overview.body.sessions).toBe(5);
    expect(overview.body.topPaths.length).toBe(2);
    expect(overview.body.topReferrers.map((r: { referrer: string }) => r.referrer)).toEqual(expect.arrayContaining(["google.com", "twitter.com"]));
    expect(overview.body.measurementNote).toContain("estimates");
  });

  it("groups frontend errors and updates counts", async () => {
    const h = makeHarness();
    const { cookie, trackingId, siteId } = await setupSite(h);
    for (let i = 0; i < 3; i++) {
      await h.json("POST", `/v1/collect/${trackingId}/error`, { v: 1, category: "uncaught", message: "TypeError: x is undefined", path: "/app", stack: "at foo (app.js:1) cookie=supersecret" }, { origin: "https://example.com" });
    }
    const list = await h.json("GET", `/v1/sites/${siteId}/errors`, { cookie });
    expect(list.body.errors).toHaveLength(1);
    expect(list.body.errors[0].count).toBe(3);
    expect(list.body.errors[0].stack).toContain("[redacted]");
    const id = list.body.errors[0].id;
    const patch = await h.json("PATCH", `/v1/errors/${id}?status=resolved`, {}, { cookie });
    expect(patch.status).toBe(200);
  });

  it("ingests and aggregates web vitals", async () => {
    const h = makeHarness();
    const { cookie, trackingId, siteId } = await setupSite(h);
    await h.json("POST", `/v1/collect/${trackingId}/perf`, { v: 1, metrics: [{ metric: "lcp", value: 1800, path: "/" }, { metric: "cls", value: 0.04, path: "/" }, { metric: "inp", value: 120, path: "/" }] }, { origin: "https://example.com" });
    const perf = await h.json("GET", `/v1/sites/${siteId}/performance?range=24h`, { cookie });
    expect(perf.status).toBe(200);
    expect(perf.body.samples).toBe(3);
    const lcp = perf.body.metrics.find((m: { metric: string }) => m.metric === "lcp");
    expect(lcp.p50).toBe(1800);
  });

  it("serves the tracking snippet only for known sites", async () => {
    const h = makeHarness();
    const { trackingId } = await setupSite(h);
    const ok = await h.fetch(`/v1/snippet/${trackingId}.js`);
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(text).toContain("VXQOR tracker");
    const missing = await h.fetch("/v1/snippet/vxq-unknown.js");
    expect(missing.status).toBe(404);
  });
});
