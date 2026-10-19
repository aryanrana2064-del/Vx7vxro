import type {
  API_SCOPES,
  CHECK_ERROR_CATEGORY,
  DEPLOYMENT_STATUS,
  ERROR_EVENT_STATUS,
  INCIDENT_STATUS,
  INTEGRATION_KIND,
  MONITOR_STATUS,
  SECURITY_CHECK_KIND,
} from "./constants";

export type MonitorStatus = (typeof MONITOR_STATUS)[number];
export type IncidentStatus = (typeof INCIDENT_STATUS)[number];
export type ErrorEventStatus = (typeof ERROR_EVENT_STATUS)[number];
export type DeploymentStatus = (typeof DEPLOYMENT_STATUS)[number];
export type CheckErrorCategory = (typeof CHECK_ERROR_CATEGORY)[number];
export type SecurityCheckKind = (typeof SECURITY_CHECK_KIND)[number];
export type IntegrationKind = (typeof INTEGRATION_KIND)[number];
export type Scope = (typeof API_SCOPES)[number];

export interface OwnerRow {
  id: string;
  email: string;
  password_hash: string;
  password_algo: string;
  created_at: string;
  updated_at: string;
  totp_secret: string | null;
  totp_enabled_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
}

export interface SessionRow {
  id: string;
  owner_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  last_seen_ip: string | null;
  user_agent: string | null;
  revoked_at: string | null;
  mfa_verified_at: string | null;
}

export interface SiteRow {
  id: string;
  name: string;
  environment: string;
  tracking_id: string;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
}

export interface SiteDomainRow {
  id: string;
  site_id: string;
  domain: string;
}

export interface MonitorRow {
  id: string;
  site_id: string;
  url: string;
  method: string;
  interval_seconds: number;
  timeout_ms: number;
  max_redirects: number;
  failure_threshold: number;
  expected_status_min: number;
  expected_status_max: number;
  slow_threshold_ms: number;
  enabled: number;
  created_at: string;
  updated_at: string;
  consecutive_failures: number;
  last_check_at: string | null;
  last_success_at: string | null;
  status: MonitorStatus;
}

export interface MonitorResultRow {
  id: string;
  monitor_id: string;
  checked_at: string;
  duration_ms: number;
  status_code: number | null;
  success: number;
  error_category: CheckErrorCategory;
  error_message: string | null;
  timed_out: number;
  redirect_count: number;
  final_url: string | null;
  resolved_ip: string | null;
  tls_expiry: string | null;
  headers: string | null;
}

export interface IncidentRow {
  id: string;
  site_id: string;
  monitor_id: string | null;
  status: IncidentStatus;
  trigger_condition: string;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface IncidentEventRow {
  id: string;
  incident_id: string;
  type: string;
  message: string;
  actor: string;
  created_at: string;
}

export interface ApiKeyRow {
  id: string;
  owner_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  rotated_from: string | null;
}

export interface DeploymentRow {
  id: string;
  site_id: string | null;
  source: string;
  environment: string;
  status: DeploymentStatus;
  commit_sha: string | null;
  commit_message: string | null;
  branch: string | null;
  url: string | null;
  error_summary: string | null;
  provider_ref: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface IntegrationRow {
  id: string;
  kind: IntegrationKind;
  config_enc: string;
  status: "connected" | "error" | "disabled";
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecurityEventRow {
  id: string;
  kind: string;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string | null;
  site_id: string | null;
  created_at: string;
}

export interface SecurityCheckRow {
  id: string;
  site_id: string | null;
  monitor_id: string | null;
  kind: SecurityCheckKind;
  status: "pass" | "warn" | "fail" | "unavailable";
  detail: string | null;
  checked_at: string;
}

export interface AuditEventRow {
  id: string;
  owner_id: string | null;
  category: string;
  action: string;
  actor: string;
  ip: string | null;
  user_agent: string | null;
  meta: string | null;
  created_at: string;
}

export interface ErrorEventRow {
  id: string;
  site_id: string;
  group_hash: string;
  category: string;
  message: string;
  stack: string | null;
  path: string | null;
  release_tag: string | null;
  correlation_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  count: number;
  status: ErrorEventStatus;
}

export interface SchedulerHeartbeatRow {
  job: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  runs: number;
  cursor: string | null;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  lastSeenIp: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface OwnerInfo {
  id: string;
  email: string;
  createdAt: string;
  mfaEnabled: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
}

export interface SystemState {
  bootstrapRequired: boolean;
  authenticated: boolean;
  owner: OwnerInfo | null;
  runtime: string;
  version: string;
  encryptionConfigured: boolean;
  scheduler: {
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    stale: boolean;
  };
}

export interface DashboardSummary {
  sites: number;
  monitorsUp: number;
  monitorsDegraded: number;
  monitorsDown: number;
  monitorsUnknown: number;
  openIncidents: number;
  acknowledgedIncidents: number;
  lastCheckAt: string | null;
  schedulerStale: boolean;
  schedulerLastRunAt: string | null;
  lastIngestionAt: string | null;
  uptimePct: number | null;
  uptimeWindowDays: number;
  responseP50: number | null;
  responseP95: number | null;
  recentDeployments: DeploymentRow[];
  recentErrors: ErrorEventRow[];
  analyticsConfigured: boolean;
  notificationsConfigured: boolean;
}

export interface TimePoint {
  ts: string;
  value: number;
}

export interface AnalyticsOverview {
  pageviews: number;
  sessions: number;
  estimatedUniqueVisitors: number;
  topPaths: { path: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
  deviceBreakdown: { label: string; count: number }[];
  timeseries: TimePoint[];
  measurementNote: string;
}

export interface PerformanceOverview {
  samples: number;
  metrics: {
    metric: string;
    p50: number | null;
    p75: number | null;
    p95: number | null;
    count: number;
  }[];
  slowestPaths: { path: string; p95: number | null; count: number }[];
  monitorLatency: TimePoint[];
  byDeployment: { deployment: string; metric: string; p75: number | null; count: number }[];
}
