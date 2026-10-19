import { TOTP, Secret } from "otpauth";
import { describe, expect, it } from "vitest";
import { bootstrapOwner, cookieFrom, makeHarness } from "./harness";

describe("authentication", () => {
  it("rejects bootstrap without the secret and before/after owner exists", async () => {
    const h = makeHarness();
    const bad = await h.json("POST", "/v1/auth/bootstrap", { bootstrapSecret: "wrong-secret-value", email: "a@b.co", password: "longenoughpassword1" });
    expect(bad.status).toBe(403);
    const ok = await bootstrapOwner(h);
    expect(ok.res.status).toBe(201);
    const again = await h.json("POST", "/v1/auth/bootstrap", { bootstrapSecret: "test-bootstrap-secret", email: "x@y.co", password: "longenoughpassword1" });
    expect(again.status).toBe(403);
  });

  it("reports system state before and after bootstrap", async () => {
    const h = makeHarness();
    const before = await h.json("GET", "/v1/system/state");
    expect(before.body.bootstrapRequired).toBe(true);
    await bootstrapOwner(h);
    const after = await h.json("GET", "/v1/system/state");
    expect(after.body.bootstrapRequired).toBe(false);
    expect(after.body.authenticated).toBe(false);
  });

  it("login succeeds with cookie and fails generically for unknown accounts", async () => {
    const h = makeHarness();
    await bootstrapOwner(h);
    const ok = await h.json("POST", "/v1/auth/login", { email: "owner@example.com", password: "correct-horse-battery" });
    expect(ok.status).toBe(200);
    expect(ok.setCookie).toContain("vxqor_session=");
    expect(ok.setCookie).toContain("HttpOnly");
    const bad = await h.json("POST", "/v1/auth/login", { email: "nobody@example.com", password: "wrongwrongwrong1" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe("invalid_credentials");
    const badPw = await h.json("POST", "/v1/auth/login", { email: "owner@example.com", password: "wrongwrongwrong1" });
    expect(badPw.body.error).toBe("invalid_credentials");
  });

  it("locks the account after repeated failures", async () => {
    const h = makeHarness();
    await bootstrapOwner(h);
    for (let i = 0; i < 5; i++) {
      await h.json("POST", "/v1/auth/login", { email: "owner@example.com", password: "wrongwrongwrong1" });
    }
    const locked = await h.json("POST", "/v1/auth/login", { email: "owner@example.com", password: "correct-horse-battery" });
    expect(locked.status).toBe(401);
    const events = await h.d1.prepare("SELECT COUNT(*) AS n FROM security_events WHERE kind = 'auth_failure'").first<{ n: number }>();
    expect((events?.n ?? 0) >= 5).toBe(true);
  });

  it("protects private routes without a session", async () => {
    const h = makeHarness();
    await bootstrapOwner(h);
    for (const p of ["/v1/sites", "/v1/monitors", "/v1/keys", "/v1/audit", "/v1/security/events", "/v1/dashboard/summary"]) {
      const res = await h.json("GET", p);
      expect(res.status).toBe(401);
    }
  });

  it("enforces origin checks on cookie-authenticated mutations", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    const evil = await h.json("POST", "/v1/sites", { name: "x", domains: ["evil.com"] }, { cookie, origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const good = await h.json("POST", "/v1/sites", { name: "x", domains: ["example.com"] }, { cookie });
    expect(good.status).toBe(201);
  });

  it("supports password change and revokes other sessions", async () => {
    const h = makeHarness();
    const first = await bootstrapOwner(h);
    const login = await h.json("POST", "/v1/auth/login", { email: "owner@example.com", password: "correct-horse-battery" });
    const second = cookieFrom(login.setCookie);
    const changed = await h.json("POST", "/v1/auth/password", { currentPassword: "correct-horse-battery", newPassword: "another-strong-password-1" }, { cookie: first.cookie });
    expect(changed.status).toBe(200);
    const oldSession = await h.json("GET", "/v1/auth/session", { cookie: second });
    expect(oldSession.status).toBe(401);
    const newLogin = await h.json("POST", "/v1/auth/login", { email: "owner@example.com", password: "another-strong-password-1" });
    expect(newLogin.status).toBe(200);
  });

  it("enrolls TOTP MFA, issues recovery codes, and requires MFA at login", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    const setup = await h.json("POST", "/v1/auth/mfa/setup", {}, { cookie });
    expect(setup.status).toBe(200);
    const secret = setup.body.secret as string;
    const totp = new TOTP({ secret: Secret.fromBase32(secret), issuer: "VXQOR", label: "owner@example.com", digits: 6, period: 30 });
    const confirm = await h.json("POST", "/v1/auth/mfa/confirm", { code: totp.generate() }, { cookie });
    expect(confirm.status).toBe(200);
    expect(confirm.body.recoveryCodes).toHaveLength(8);

    const login = await h.json("POST", "/v1/auth/login", { email: "owner@example.com", password: "correct-horse-battery" });
    expect(login.body.mfaRequired).toBe(true);
    const challenge = login.body.challenge as string;

    const badCode = await h.json("POST", "/v1/auth/mfa/verify", { challenge, code: "000000" });
    expect(badCode.status).toBe(401);

    const goodCode = await h.json("POST", "/v1/auth/mfa/verify", { challenge, code: totp.generate() });
    expect(goodCode.status).toBe(200);
    const mfaCookie = cookieFrom(goodCode.setCookie);

    const login2 = await h.json("POST", "/v1/auth/login", { email: "owner@example.com", password: "correct-horse-battery" });
    const recovery = confirm.body.recoveryCodes[0] as string;
    const recovered = await h.json("POST", "/v1/auth/mfa/verify", { challenge: login2.body.challenge, code: recovery });
    expect(recovered.status).toBe(200);
    const used = await h.d1.prepare("SELECT used_at FROM recovery_codes WHERE code_hash IS NOT NULL AND used_at IS NOT NULL").first<{ used_at: string }>();
    expect(used?.used_at).toBeTruthy();
    expect(mfaCookie).toContain("vxqor_session=");
  });

  it("lists and revokes sessions", async () => {
    const h = makeHarness();
    const { cookie } = await bootstrapOwner(h);
    const list = await h.json("GET", "/v1/auth/sessions", { cookie });
    expect(list.body.sessions.length).toBe(1);
    const id = list.body.sessions[0].id;
    const revoked = await h.json("POST", `/v1/auth/sessions/${id}/revoke`, {}, { cookie });
    expect(revoked.status).toBe(200);
    const after = await h.json("GET", "/v1/auth/session", { cookie });
    expect(after.status).toBe(401);
  });
});
