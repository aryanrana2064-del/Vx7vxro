export const API_VERSION = "v1";

export const COOKIE_NAME = "vxqor_session";

export const MONITOR_STATUS = ["unknown", "up", "degraded", "down"] as const;
export const INCIDENT_STATUS = ["detected", "acknowledged", "investigating", "resolved"] as const;
export const ERROR_EVENT_STATUS = ["open", "resolved", "ignored"] as const;
export const DEPLOYMENT_STATUS = ["queued", "building", "ready", "error", "canceled"] as const;
export const CHECK_ERROR_CATEGORY = [
  "none",
  "dns",
  "tls",
  "timeout",
  "http_status",
  "redirect_limit",
  "ssrf_blocked",
  "response_too_large",
  "network",
] as const;
export const SECURITY_CHECK_KIND = ["https", "headers", "dns", "ssl_expiry"] as const;
export const INTEGRATION_KIND = ["github", "vercel"] as const;

export const API_SCOPES = [
  "sites:read",
  "sites:write",
  "monitoring:read",
  "monitoring:write",
  "analytics:read",
  "performance:read",
  "errors:read",
  "deployments:read",
  "deployments:write",
  "security:read",
  "audit:read",
  "exports:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const ANALYTIC_RANGES = ["24h", "7d", "30d", "90d"] as const;
export type AnalyticRange = (typeof ANALYTIC_RANGES)[number];

export const RANGE_MS: Record<AnalyticRange, number> = {
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
  "90d": 90 * 24 * 3600_000,
};

export const DEFAULT_RETENTION_DAYS = {
  monitor_results: 30,
  analytics_events: 90,
  perf_events: 90,
  audit_events: 365,
  security_events: 365,
  api_usage_hourly: 90,
} as const;

export const MAX_EXPORT_ROWS = 50_000;
export const MAX_INGEST_BATCH = 50;
export const TRACKING_SNIPPET_VERSION = 1;
