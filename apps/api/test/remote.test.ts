import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRemoteDiscovery } from "../src/lib/remote";
import { bootstrapOwner, makeHarness } from "./harness";

const REMOTE = { url: "https://remote.example.workers.dev", token: "secret-remote-token" };

afterEach(() => {
  vi.unstubAllGlobals();
  resetRemoteDiscovery();
});

describe("remote website registry proxy", () => {
  it("reports not_configured without a server-side token", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    const status = await h.json("GET", "/v1/remote/status", { cookie });
    expect(status.body.configured).toBe(false);
    expect(status.body.authOk).toBeNull();
  });

  it("lists remote websites and never leaks the token", async () => {
    const h = makeHarness({ remote: REMOTE });
    const { cookie } = await bootstrapOwner(h);
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe(`${REMOTE.url}/websites`);
      expect((init?.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${REMOTE.token}`);
      return new Response(JSON.stringify({ websites: [{ id: "w1", name: "Shop", domain: "shop.example.com", environment: "production" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await h.json("GET", "/v1/remote/websites", { cookie });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("remote");
    expect(res.body.sites[0]).toMatchObject({ id: "w1", name: "Shop", domains: ["shop.example.com"], source: "remote" });
    expect(JSON.stringify(res.body)).not.toContain(REMOTE.token);
  });

  it("creates a remote website with a superset payload", async () => {
    const h = makeHarness({ remote: REMOTE });
    const { cookie } = await bootstrapOwner(h);
    let sentBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: "w2", name: "New", domain: "new.example.com" }), { status: 201 });
      }),
    );
    const res = await h.json("POST", "/v1/remote/websites", { name: "New", environment: "production", domains: ["new.example.com"] }, { cookie });
    expect(res.status).toBe(201);
    expect(res.body.site.id).toBe("w2");
    expect(sentBody).toMatchObject({ name: "New", domain: "new.example.com", url: "https://new.example.com" });
    expect(Array.isArray(sentBody.domains)).toBe(true);
  });

  it("surfaces auth rejection without exposing the token", async () => {
    const h = makeHarness({ remote: REMOTE });
    const { cookie } = await bootstrapOwner(h);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
    const res = await h.json("GET", "/v1/remote/websites", { cookie });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("auth_rejected");
    const status = await h.json("GET", "/v1/remote/status", { cookie });
    expect(status.body.authOk).toBe(false);
    expect(JSON.stringify(status.body)).not.toContain(REMOTE.token);
  });

  it("protects proxy routes behind the owner session", async () => {
    const h = makeHarness({ remote: REMOTE });
    const res = await h.json("GET", "/v1/remote/websites");
    expect(res.status).toBe(401);
  });
});
