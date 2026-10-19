/**
 * Server-side client for the deployed VXQOR Worker that owns the production
 * vxqor-db website registry. The API token lives only in server environment
 * (Worker secret / Node env) and is never returned to or rendered by clients.
 */
import type { AppConfig } from "../env";
import { log } from "./log";

export const REMOTE_SITE_PATHS = ["/websites", "/api/websites", "/v1/websites", "/sites", "/api/sites", "/v1/sites"] as const;

export interface RemoteSite {
  id: string;
  name: string;
  environment: string;
  domains: string[];
  trackingId: string;
  createdAt: string | null;
  source: "remote";
}

let discoveredPath: string | null = null;

export function resetRemoteDiscovery(): void {
  discoveredPath = null;
}

async function remoteFetch(cfg: AppConfig, path: string, init: RequestInit = {}): Promise<Response> {
  if (!cfg.remoteApiUrl || !cfg.remoteApiToken) throw new RemoteError("not_configured", 503);
  const res = await fetch(`${cfg.remoteApiUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${cfg.remoteApiToken}`,
      "content-type": "application/json",
      accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

export class RemoteError extends Error {
  constructor(
    public reason: string,
    public status: 404 | 502 | 503 = 502,
  ) {
    super(reason);
  }
}

function extractList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["websites", "sites", "data", "items", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  return [];
}

export function normalizeRemoteSite(raw: unknown): RemoteSite | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = r.id ?? r.site_id ?? r.uuid;
  if (id === undefined || id === null) return null;
  const domainsRaw = Array.isArray(r.domains) ? (r.domains as unknown[]).map(String) : typeof r.domain === "string" && r.domain ? [r.domain] : typeof r.url === "string" && r.url ? [safeHost(r.url)] : [];
  return {
    id: String(id),
    name: String(r.name ?? r.title ?? domainsRaw[0] ?? "unnamed"),
    environment: String(r.environment ?? "production"),
    domains: domainsRaw.filter(Boolean),
    trackingId: typeof r.tracking_id === "string" ? r.tracking_id : typeof r.trackingId === "string" ? r.trackingId : "",
    createdAt: typeof r.created_at === "string" ? r.created_at : typeof r.createdAt === "string" ? r.createdAt : null,
    source: "remote",
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export async function listRemoteSites(cfg: AppConfig): Promise<RemoteSite[]> {
  const paths = discoveredPath ? [discoveredPath, ...REMOTE_SITE_PATHS.filter((p) => p !== discoveredPath)] : [...REMOTE_SITE_PATHS];
  for (const path of paths) {
    const res = await remoteFetch(cfg, path).catch((err) => {
      throw new RemoteError(`network_error:${String((err as Error).message)}`);
    });
    if (res.status === 401 || res.status === 403) throw new RemoteError("auth_rejected", 502);
    if (!res.ok) continue;
    const body = (await res.json().catch(() => null)) as unknown;
    discoveredPath = path;
    return extractList(body).map(normalizeRemoteSite).filter((s): s is RemoteSite => s !== null);
  }
  throw new RemoteError("no_website_route_found", 404);
}

export async function createRemoteSite(cfg: AppConfig, input: { name: string; environment: string; domains: string[] }): Promise<RemoteSite> {
  const paths = discoveredPath ? [discoveredPath, ...REMOTE_SITE_PATHS.filter((p) => p !== discoveredPath)] : [...REMOTE_SITE_PATHS];
  const payload = {
    name: input.name,
    environment: input.environment,
    domains: input.domains,
    domain: input.domains[0],
    url: input.domains[0] ? `https://${input.domains[0]}` : undefined,
  };
  let lastStatus = 0;
  for (const path of paths) {
    const res = await remoteFetch(cfg, path, { method: "POST", body: JSON.stringify(payload) }).catch((err) => {
      throw new RemoteError(`network_error:${String((err as Error).message)}`);
    });
    if (res.status === 401 || res.status === 403) throw new RemoteError("auth_rejected", 502);
    lastStatus = res.status;
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as unknown;
      discoveredPath = path;
      const record = normalizeRemoteSite(body && typeof body === "object" && !Array.isArray(body) && (body as Record<string, unknown>).website ? (body as Record<string, unknown>).website : body);
      if (record) return record;
      const listed = await listRemoteSites(cfg);
      const match = listed.find((s) => s.name === input.name);
      if (match) return match;
      throw new RemoteError("created_but_unreadable", 502);
    }
    if (res.status === 404 || res.status === 405) continue;
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    log("warn", "remote_create_rejected", { path, status: res.status });
    throw new RemoteError(`remote_rejected_${res.status}:${detail}`, 502);
  }
  throw new RemoteError(`no_website_route_found_${lastStatus}`, 404);
}

export async function remoteStatus(cfg: AppConfig): Promise<{ configured: boolean; authOk: boolean | null; url: string | null; discoveredPath: string | null }> {
  if (!cfg.remoteApiUrl || !cfg.remoteApiToken) return { configured: false, authOk: null, url: cfg.remoteApiUrl, discoveredPath: null };
  try {
    await listRemoteSites(cfg);
    return { configured: true, authOk: true, url: cfg.remoteApiUrl, discoveredPath };
  } catch (err) {
    const reason = err instanceof RemoteError ? err.reason : "unknown";
    return { configured: true, authOk: reason === "auth_rejected" ? false : null, url: cfg.remoteApiUrl, discoveredPath };
  }
}
