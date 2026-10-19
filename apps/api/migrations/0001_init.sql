-- VXQOR initial schema (SQLite / Cloudflare D1)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_seen_ip TEXT,
  user_agent TEXT,
  revoked_at TEXT,
  mfa_verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_id);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_recovery_owner ON recovery_codes(owner_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_events(category, created_at);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  site_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_created ON security_events(created_at);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  environment TEXT NOT NULL,
  tracking_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE IF NOT EXISTS site_domains (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  UNIQUE(site_id, domain)
);

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  interval_seconds INTEGER NOT NULL DEFAULT 300,
  timeout_ms INTEGER NOT NULL DEFAULT 10000,
  max_redirects INTEGER NOT NULL DEFAULT 2,
  failure_threshold INTEGER NOT NULL DEFAULT 2,
  expected_status_min INTEGER NOT NULL DEFAULT 200,
  expected_status_max INTEGER NOT NULL DEFAULT 399,
  slow_threshold_ms INTEGER NOT NULL DEFAULT 3000,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_check_at TEXT,
  last_success_at TEXT,
  status TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_monitors_site ON monitors(site_id);
CREATE INDEX IF NOT EXISTS idx_monitors_due ON monitors(enabled, last_check_at);

CREATE TABLE IF NOT EXISTS monitor_results (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status_code INTEGER,
  success INTEGER NOT NULL,
  error_category TEXT NOT NULL DEFAULT 'none',
  error_message TEXT,
  timed_out INTEGER NOT NULL DEFAULT 0,
  redirect_count INTEGER NOT NULL DEFAULT 0,
  final_url TEXT,
  resolved_ip TEXT,
  tls_expiry TEXT,
  headers TEXT
);
CREATE INDEX IF NOT EXISTS idx_results_monitor_time ON monitor_results(monitor_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_results_time ON monitor_results(checked_at);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  monitor_id TEXT REFERENCES monitors(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  trigger_condition TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, detected_at);
CREATE INDEX IF NOT EXISTS idx_incidents_site ON incidents(site_id, detected_at);

CREATE TABLE IF NOT EXISTS incident_events (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incident_events ON incident_events(incident_id, created_at);

CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  custom_name TEXT,
  session_hash TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer_category TEXT NOT NULL DEFAULT 'direct',
  referrer_domain TEXT,
  browser TEXT NOT NULL DEFAULT 'unknown',
  device TEXT NOT NULL DEFAULT 'unknown',
  country TEXT,
  dedupe_hash TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_site_time ON analytics_events(site_id, ts);
CREATE INDEX IF NOT EXISTS idx_analytics_time ON analytics_events(ts);

CREATE TABLE IF NOT EXISTS perf_events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  path TEXT NOT NULL,
  browser TEXT NOT NULL DEFAULT 'unknown',
  device TEXT NOT NULL DEFAULT 'unknown',
  deployment_id TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_perf_site_metric_time ON perf_events(site_id, metric, ts);
CREATE INDEX IF NOT EXISTS idx_perf_time ON perf_events(ts);

CREATE TABLE IF NOT EXISTS error_events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  group_hash TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  path TEXT,
  release_tag TEXT,
  correlation_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  UNIQUE(site_id, group_hash)
);
CREATE INDEX IF NOT EXISTS idx_errors_site_seen ON error_events(site_id, last_seen_at);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL,
  commit_sha TEXT,
  commit_message TEXT,
  branch TEXT,
  url TEXT,
  error_summary TEXT,
  provider_ref TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deployments_created ON deployments(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_ref ON deployments(provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked_at TEXT,
  rotated_from TEXT
);
CREATE INDEX IF NOT EXISTS idx_keys_owner ON api_keys(owner_id);

CREATE TABLE IF NOT EXISTS api_usage_hourly (
  key_id TEXT NOT NULL,
  hour TEXT NOT NULL,
  route TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, hour, route)
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL UNIQUE,
  config_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_cache (
  kind TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_checks (
  id TEXT PRIMARY KEY,
  site_id TEXT,
  monitor_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checks_monitor ON security_checks(monitor_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_checks_kind ON security_checks(kind, checked_at);

CREATE TABLE IF NOT EXISTS dns_records (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  record_type TEXT NOT NULL,
  value TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(domain, record_type, value)
);

CREATE TABLE IF NOT EXISTS scheduler_heartbeats (
  job TEXT PRIMARY KEY,
  last_run_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  cursor TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
