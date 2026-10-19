# VXQOR Implementation Plan & Checklist

Status legend: ✅ verified (tests/build/manual run) · 🟡 partial, documented · ⬜ pending

## Phase 1 — Foundation ✅
- [x] Repo inspection (empty except brand JPEGs → scaffolded monorepo)
- [x] Architecture doc + diagram (ARCHITECTURE.md)
- [x] Design system: Precision Dark tokens, component library (buttons, inputs, selects,
      dialogs, drawers, tabs, toasts, tables, pagination, badges, status dots, skeletons,
      empty/error states, confirm dialogs, error boundary), reduced-motion support
- [x] Responsive shell: collapsible sidebar groups, topbar with scheduler health + user menu,
      mobile drawer, keyboard-accessible nav
- [x] D1 migrations 0001/0002 with indexes + retention strategy
- [x] Owner auth: bootstrap secret, PBKDF2 login, sessions (rotation/revocation/expiry/device list),
      lockout + rate limits, origin/CSRF guard, generic errors
- [x] MFA: TOTP enroll/confirm/disable + hashed single-use recovery codes + regenerate
- [x] Tests: 37 passing (auth incl. MFA + lockout + CSRF, SSRF matrix, monitoring, analytics, keys, e2e)

## Phase 2 — Real monitoring ✅
- [x] Website registry CRUD with domain allowlists, duplicate detection, disable, confirmed delete
- [x] Safe URL validation at create + check time (SSRF suite tested: IPv4/IPv6/mapped/redirect hops)
- [x] Monitoring worker: cron (Workers) + interval (Node), timeouts, bounded reads, retry+backoff,
      failure thresholds, degraded/slow classification, incident open/resolve with dedupe
- [x] Scheduler heartbeat + missed-check detection + stale badges in UI
- [x] Manual "check now", results drawer with latency chart + percentiles
- [x] Honest dashboard (no data → setup actions; stale scheduler warning; notifications-not-configured banner)

## Phase 3 — Analytics & performance ✅
- [x] Public tracking id + served snippet (pageviews, SPA navigation, custom events, CWV, errors)
- [x] Ingestion: validation, rate limits, origin allowlist, dedupe index, bounded batches
- [x] Privacy-conscious fingerprints; measurement caveats surfaced in UI
- [x] Aggregations: totals/sessions/est-uniques, top paths/referrers/devices, time series
- [x] Performance: LCP/INP/CLS/FCP/TTFB percentiles, slowest paths, per-deployment comparison,
      monitor latency series; sample counts shown
- [x] Exports CSV/JSON with 50k row cap (Reports page + API)

## Phase 4 — Developer integrations 🟡
- [x] Deployments: API-key ingestion with commit dedupe, Vercel sync upsert, timeline UI
- [x] GitHub integration: encrypted token, validation on save, sync commits/PRs/releases, Git Activity UI
- [ ] GitHub code diffs / changed-files view (bounded-diff browsing) — pending
- [ ] Vercel webhook signature verification — pending (poll/sync supported instead)

## Phase 5 — Errors, logs & security ✅
- [x] Frontend error instrumentation + grouping + redaction + status workflow
- [x] Security checks: https availability, security headers audit, DNS change detection,
      SSL expiry (Node scheduler; honest `unavailable` on Workers)
- [x] Security events + audit trail pages with pagination/filters
- [x] Alerting: signed webhook adapter, test-send, not-configured states

## Phase 6 — API platform ✅
- [x] API keys: scopes, expiry, rotation, revocation, hashed storage, usage accounting
- [x] API Explorer: real read-only requests against live backend, documented auth schemes
- [x] Rate limits on ingestion + login; request-size bounds on ingestion batches

## Phase 7 — Production hardening 🟡
- [x] Full test pass (37/37), strict typecheck, production build with route-level code splitting
- [x] Retention cleanup job + backup/restore docs
- [x] Accessibility: labels, focus-visible rings, aria roles on dialogs/drawers/tabs/toasts
- [ ] Automated UI tests (Playwright) — pending; manual browser verification done (setup → overview →
      sites → monitors → scheduler → analytics) on 2026-10-19
- [ ] Lighthouse/perf budget run on deployed build — pending (local build metrics only)

## Prioritized next steps
1. Playwright smoke suite for login/MFA/monitor-creation flows.
2. GitHub diff viewer with bounded file diffs.
3. Vercel webhook endpoint with signature verification.
4. PDF report export if a reliable generator is acceptable.
5. Queue-based ingestion buffering if write volume approaches D1 Free caps.
