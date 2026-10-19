# VXQOR Architecture

## Diagram

```
                        ┌───────────────────────────────┐
   owner browser ──────►│  Vercel: apps/web             │
                        │  React 18 + Router + TanStack │
                        │  Query + Tailwind (Precision  │
                        │  Dark)                        │
                        └──────────────┬────────────────
                                       │ fetch /v1/* (credentials: include)
                                       ▼
                        ┌───────────────────────────────┐
   tracked visitors ───►│  Cloudflare Worker: apps/api  │◄─── cron */5 * * * *
   (public snippet,     │  Hono routes                  │     (monitoring scheduler)
    no auth)            │  ├─ /v1/auth/*  (session+MFA) │
                        │  ├─ /v1/sites|monitors|…      │
                        │  ├─ /v1/collect/:id/* public  │
                        │  └─ scheduled() → jobs/       │
                        └──────┬───────────────┬────────┘
                               │ D1 binding    │ outbound (explicit timeouts)
                               ▼               ▼
                        ┌────────────   monitored endpoints, DoH resolver,
                        │ Cloudflare │   GitHub/Vercel APIs, alert webhooks
                        │ D1 (SQLite)│
                        └────────────┘
```

Local development mirrors this with `src/dev-node.ts`: same Hono app, `node:sqlite`
behind a D1-compatible shim (`lib/sqlite-d1.ts`), `setInterval` scheduler, and real
TLS certificate probes via `node:tls` (Workers cannot inspect peer certificates).

## Request paths

1. **Private admin APIs** — cookie session (PBKDF2 hash verify, session row lookup by
   token hash) or bearer API key (SHA-256 hash lookup + scope check). Mutations with a
   cookie additionally pass the origin guard. Every privileged action writes an audit row.
2. **Public ingestion** — `POST /v1/collect/:trackingId/{analytics,perf,error}` and
   `GET /v1/snippet/:id.js`. No auth; protected by schema validation, fixed-window rate
   limits (D1 table), origin allowlist per site, and dedupe keys (partial unique index).
3. **Scheduler** — `scheduled()` (Workers cron) or interval (Node): selects due monitors
   (bounded by `VXQOR_MAX_CHECKS_PER_RUN`), SSRF-validates, fetches with manual redirect
   handling + bounded body reads, persists results, advances monitor state and incident
   lifecycle, runs security checks (https/headers/dns/ssl_expiry), detects missed checks,
   prunes retention, and updates the heartbeat row that the UI reads for staleness.

## Data model (D1, migrations in `apps/api/migrations`)

owners, sessions, mfa_challenges, recovery_codes, audit_events, security_events,
sites, site_domains, monitors, monitor_results, incidents, incident_events,
analytics_events, perf_events, error_events, deployments, api_keys, api_usage_hourly,
integrations (AES-256-GCM encrypted config), integration_cache, security_checks,
dns_records, scheduler_heartbeats, settings, rate_limits.

Indexes target the hot paths: `(monitor_id, checked_at)`, `(site_id, ts)`,
`(site_id, metric, ts)`, `(status, detected_at)`, partial unique dedupe on analytics.

## Key design decisions

- **Single code path for Workers and Node**: runtime differences (TLS probes,
  executionCtx) are injected, not branched across duplicated code.
- **No ORM**: typed thin query helpers over D1 keep the Worker bundle small and the
  SQL reviewable; schemas are versioned migrations, applied via Wrangler.
- **Honest states everywhere**: scheduler heartbeat drives "stale" badges; empty tables
  render setup actions; Workers runtime reports `ssl_expiry: unavailable` instead of
  guessing certificate data.
- **Secrets**: integration tokens encrypted at rest (AES-256-GCM, key from
  `VXQOR_ENCRYPTION_KEY`); API keys stored as SHA-256 hashes with a display prefix;
  recovery codes hashed; passwords PBKDF2; nothing secret in `VITE_*` vars or bundles.

## Free-tier engineering

- Cron cadence 5 min (Free minimum is 1 min; 5 min keeps D1 write volume low).
- Checks per run capped (50 subrequest limit); overdue monitors are picked up next run
  and surfaced via missed-check detection instead of silently dropping.
- Retention cleanup hourly: monitor_results 30d, analytics/perf 90d, audit/security 365d
  (overridable via `VXQOR_RETENTION`) to stay inside D1 Free storage/write caps.
