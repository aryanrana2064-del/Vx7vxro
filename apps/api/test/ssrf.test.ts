import { describe, expect, it } from "vitest";
import { isBlockedIp, isBlockedHostname, parseTargetUrl, validateTarget } from "../src/lib/ssrf";

describe("ssrf protection", () => {
  it("blocks private, loopback, link-local and reserved ipv4 ranges", () => {
    const blocked = [
      "127.0.0.1", "127.1.2.3", "10.0.0.1", "10.255.255.255", "192.168.1.1", "172.16.0.1", "172.31.255.255",
      "169.254.169.254", "169.254.1.1", "0.0.0.0", "100.64.0.1", "192.0.0.5", "198.18.0.1", "198.51.100.2",
      "203.0.113.9", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    ];
    for (const ip of blocked) expect(isBlockedIp(ip), ip).toBe(true);
    const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "100.128.0.1"];
    for (const ip of allowed) expect(isBlockedIp(ip), ip).toBe(false);
  });

  it("blocks ipv6 loopback, unique-local, link-local and mapped v4", () => {
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("fc00::1")).toBe(true);
    expect(isBlockedIp("fd12:3456::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("ff02::1")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
    expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
    expect(isBlockedIp("2001:db8::1")).toBe(true);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });

  it("blocks internal hostnames", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedHostname("host.local")).toBe(true);
    expect(isBlockedHostname("svc.cluster.internal")).toBe(true);
    expect(isBlockedHostname("example.com")).toBe(false);
  });

  it("validates scheme, port and userinfo", () => {
    expect(parseTargetUrl("ftp://example.com/x").error).toBe("scheme_not_allowed");
    expect(parseTargetUrl("javascript:alert(1)").error).toBe("scheme_not_allowed");
    expect(parseTargetUrl("http://user:pass@example.com/").error).toBe("userinfo_not_allowed");
    expect(parseTargetUrl("http://example.com:9999/").error).toBe("port_not_allowed");
    expect(parseTargetUrl("https://example.com:8443/").error).toBeUndefined();
    expect(parseTargetUrl("http://example.com/").error).toBeUndefined();
  });

  it("rejects targets whose DNS resolves to blocked ranges", async () => {
    const resolver = async () => ["169.254.169.254"];
    const res = await validateTarget("https://evil.example/", resolver);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("ip_range_blocked");
  });

  it("rejects literal ip targets in blocked ranges and accepts public ones", async () => {
    const bad = await validateTarget("http://127.0.0.1:8080/");
    expect(bad.ok).toBe(false);
    const good = await validateTarget("https://8.8.8.8/");
    expect(good.ok).toBe(true);
  });

  it("fails closed when dns returns no records", async () => {
    const res = await validateTarget("https://nope.invalid/", async () => []);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("dns_no_records");
  });
});
