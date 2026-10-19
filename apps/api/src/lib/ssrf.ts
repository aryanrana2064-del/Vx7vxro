/**
 * SSRF protection for the monitoring engine.
 *
 * Every target (and every redirect hop) is validated before a request is made:
 * scheme allowlist, port allowlist, no userinfo, hostname blocklist, and DNS
 * resolution via DoH with strict IP-range rejection (loopback, private,
 * link-local, multicast, reserved, cloud metadata).
 */

export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "ip6-localhost",
  "ip6-loopback",
]);

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home", ".lan", ".intranet"];

export interface SsrfValidation {
  ok: boolean;
  reason?: string;
  ips: string[];
}

export function parseTargetUrl(raw: string): { url: URL; error?: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { url: new URL("http://invalid.invalid"), error: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { url, error: "scheme_not_allowed" };
  }
  if (url.username || url.password) return { url, error: "userinfo_not_allowed" };
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (!Number.isInteger(port) || !ALLOWED_PORTS.has(port)) return { url, error: "port_not_allowed" };
  return { url };
}

function parseIpv4(part: string): number[] | null {
  const groups = part.split(".");
  if (groups.length !== 4) return null;
  const nums: number[] = [];
  for (const g of groups) {
    if (!/^\d{1,3}$/.test(g)) return null;
    const n = Number(g);
    if (n < 0 || n > 255) return null;
    nums.push(n);
  }
  return nums;
}

function expandIpv6(ip: string): number[] | null {
  // Returns 8 groups of 16-bit values, or null when not an IPv6 literal.
  let head = ip;
  let tail: string[] = [];
  const v4Suffix = ip.match(/(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Suffix) {
    const v4 = parseIpv4(v4Suffix[2] ?? "");
    if (!v4) return null;
    tail = [
      ((v4[0] ?? 0) << 8 | (v4[1] ?? 0)).toString(16),
      ((v4[2] ?? 0) << 8 | (v4[3] ?? 0)).toString(16),
    ];
    head = v4Suffix[1] ?? "";
    head = head.slice(0, -1);
  }
  const dbl = head.split("::");
  if (dbl.length > 2) return null;
  const parseGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const parts = s.split(":");
    const out: number[] = [];
    for (const p of parts) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(p)) return null;
      out.push(Number.parseInt(p, 16));
    }
    return out;
  };
  let groups: number[];
  if (dbl.length === 2) {
    const left = parseGroups(dbl[0] ?? "");
    const right = parseGroups(dbl[1] ?? "");
    if (!left || !right) return null;
    const fill = 8 - left.length - right.length - tail.length;
    if (fill < 1) return null;
    groups = [...left, ...new Array(fill).fill(0), ...right, ...tail.map((t) => Number.parseInt(t, 16))];
  } else {
    const only = parseGroups(head);
    if (!only) return null;
    groups = [...only, ...tail.map((t) => Number.parseInt(t, 16))];
  }
  if (groups.length !== 8) return null;
  return groups;
}

export function isBlockedIp(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(trimmed);
  if (v4) {
    const [a, b] = [v4[0] ?? 0, v4[1] ?? 0];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 0) return true; // 192.0.0/24 IETF
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 192 && b === 0 && (v4[2] ?? 0) === 2) return true; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51 && (v4[2] ?? 0) === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && (v4[2] ?? 0) === 113) return true; // TEST-NET-3
    if (a >= 224 && a <= 239) return true; // multicast
    if (a >= 240) return true; // reserved + broadcast
    return false;
  }
  const v6 = expandIpv6(trimmed);
  if (v6) {
    const [g0, g1] = [v6[0] ?? 0, v6[1] ?? 0];
    const isAllZero = v6.every((g) => g === 0);
    if (isAllZero) return true; // ::/128
    if (v6.slice(0, 7).every((g) => g === 0) && (v6[7] ?? 0) === 1) return true; // ::1 loopback
    if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g0 & 0xff00) === 0xff00) return true; // ff00::/10 multicast
    if (v6.slice(0, 5).every((g) => g === 0) && (v6[5] ?? 0) === 0xffff) {
      const hi = v6[6] ?? 0;
      const lo = v6[7] ?? 0;
      const mapped = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
      return isBlockedIp(mapped);
    }
    if (g0 === 0x2001 && (g1 & 0xfff0) === 0xdb0) return true; // 2001:db8::/32 documentation
    if (g0 === 0xfec0) return true; // deprecated site-local
    if ((g0 & 0xfe00) === 0xfc00) return true;
    return false;
  }
  // Not parseable as an IP: treat as unsafe (caller should only pass IPs here).
  return true;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  for (const suffix of BLOCKED_HOST_SUFFIXES) if (host.endsWith(suffix)) return true;
  return false;
}

export function ipLiteral(hostname: string): string | null {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (parseIpv4(bare)) return bare;
  if (expandIpv6(bare)) return bare;
  return null;
}

export interface DohResolver {
  (hostname: string): Promise<string[]>;
}

/** Default resolver: DNS-over-HTTPS (Cloudflare) returning A + AAAA answers. */
export const dohResolve: DohResolver = async (hostname) => {
  const ips = new Set<string>();
  for (const type of ["A", "AAAA"] as const) {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) continue;
    const body = (await res.json()) as { Answer?: { type: number; data: string }[] };
    for (const answer of body.Answer ?? []) {
      if (answer.type === 1 || answer.type === 28) ips.add(answer.data);
    }
  }
  return [...ips];
};

export async function validateTarget(rawUrl: string, resolve: DohResolver = dohResolve): Promise<SsrfValidation> {
  const { url, error } = parseTargetUrl(rawUrl);
  if (error) return { ok: false, reason: error, ips: [] };
  const hostname = url.hostname.toLowerCase();
  const literal = ipLiteral(hostname);
  if (literal) {
    return isBlockedIp(literal) ? { ok: false, reason: "ip_range_blocked", ips: [literal] } : { ok: true, ips: [literal] };
  }
  if (isBlockedHostname(hostname)) return { ok: false, reason: "hostname_blocked", ips: [] };
  let ips: string[] = [];
  try {
    ips = await resolve(hostname);
  } catch {
    return { ok: false, reason: "dns_resolution_failed", ips: [] };
  }
  if (ips.length === 0) return { ok: false, reason: "dns_no_records", ips: [] };
  for (const ip of ips) {
    if (isBlockedIp(ip)) return { ok: false, reason: "ip_range_blocked", ips };
  }
  return { ok: true, ips };
}
