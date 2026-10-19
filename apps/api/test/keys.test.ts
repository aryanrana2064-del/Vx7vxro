import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/lib/crypto";
import { bootstrapOwner, makeHarness } from "./harness";

describe("api keys", () => {
  it("creates keys, shows the secret once, and enforces scopes", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    await h.json("POST", "/v1/sites", { name: "Prod", domains: ["example.com"] }, { cookie });
    const created = await h.json("POST", "/v1/keys", { name: "ci", scopes: ["sites:read"] }, { cookie });
    expect(created.status).toBe(201);
    const secret = created.body.secret as string;
    expect(secret.startsWith("vxqor_")).toBe(true);

    const withKey = await h.json("GET", "/v1/sites", { origin: null, headers: { authorization: `Bearer ${secret}` } });
    expect(withKey.status).toBe(200);

    const forbidden = await h.json("POST", "/v1/deployments", { environment: "production", source: "ci", status: "ready" }, { origin: null, headers: { authorization: `Bearer ${secret}` } });
    expect(forbidden.status).toBe(403);

    const badKey = await h.json("GET", "/v1/sites", { origin: null, headers: { authorization: "Bearer vxqor_nope" } });
    expect(badKey.status).toBe(401);
  });

  it("rejects revoked and expired keys", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    const created = await h.json("POST", "/v1/keys", { name: "tmp", scopes: ["sites:read"] }, { cookie });
    const secret = created.body.secret as string;
    const id = created.body.key.id as string;
    await h.json("POST", `/v1/keys/${id}/revoke`, {}, { cookie });
    const revoked = await h.json("GET", "/v1/sites", { origin: null, headers: { authorization: `Bearer ${secret}` } });
    expect(revoked.status).toBe(401);

    const expiring = await h.json("POST", "/v1/keys", { name: "short", scopes: ["sites:read"], expiresInSeconds: 3600 }, { cookie });
    const expSecret = expiring.body.secret as string;
    // Force expiry in the database to simulate time passing.
    await h.d1.prepare("UPDATE api_keys SET expires_at = '2000-01-01T00:00:00.000Z' WHERE key_hash = ?").bind(await sha256Hex(expSecret)).run();
    const expired = await h.json("GET", "/v1/sites", { origin: null, headers: { authorization: `Bearer ${expSecret}` } });
    expect(expired.status).toBe(401);
  });

  it("rotates keys, invalidating the old secret", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    const created = await h.json("POST", "/v1/keys", { name: "rotate-me", scopes: ["deployments:write", "deployments:read"] }, { cookie });
    const oldSecret = created.body.secret as string;
    const rotated = await h.json("POST", `/v1/keys/${created.body.key.id}/rotate`, {}, { cookie });
    expect(rotated.status).toBe(200);
    const newSecret = rotated.body.secret as string;
    expect(newSecret).not.toBe(oldSecret);
    const oldUse = await h.json("GET", "/v1/deployments", { origin: null, headers: { authorization: `Bearer ${oldSecret}` } });
    expect(oldUse.status).toBe(401);
    const newUse = await h.json("GET", "/v1/deployments", { origin: null, headers: { authorization: `Bearer ${newSecret}` } });
    expect(newUse.status).toBe(200);
  });

  it("records deployments via scoped keys and dedupes by commit", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    const created = await h.json("POST", "/v1/keys", { name: "ci", scopes: ["deployments:write", "deployments:read"] }, { cookie });
    const secret = created.body.secret as string;
    const body = { environment: "production", source: "ci", status: "ready", commitSha: "abc1234def", commitMessage: "ship it", branch: "main" };
    const first = await h.json("POST", "/v1/deployments", body, { origin: null, headers: { authorization: `Bearer ${secret}` } });
    expect(first.status).toBe(201);
    const second = await h.json("POST", "/v1/deployments", body, { origin: null, headers: { authorization: `Bearer ${secret}` } });
    expect(second.body.deployment.deduplicated).toBe(true);
    const list = await h.json("GET", "/v1/deployments", { origin: null, headers: { authorization: `Bearer ${secret}` } });
    expect(list.body.deployments).toHaveLength(1);
  });
});
