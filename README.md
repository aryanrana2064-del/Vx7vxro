# VXQOR

Private, production-oriented **website intelligence, monitoring, analytics & security platform** for a single authorized owner.

- Real authentication (PBKDF2-SHA256 + optional TOTP MFA + recovery codes), real D1/SQLite persistence, real scheduled HTTP monitoring with SSRF protection, real analytics ingestion via a public tracking snippet, scoped API keys, integrations (GitHub/Vercel/webhook alerts), CSV/JSON exports, audit + security event trails.
- No demo data, no fabricated metrics. Every screen is empty until real measurements exist.

## Repository layout

```
apps/api        Cloudflare Worker (Hono) — API + cron monitoring scheduler
                Also runs on Node (node:sqlite D1 shim) for local dev/tests
apps/web        Vite + React 18 + TypeScript strict + React Router 7 +
                Tailwind v4 + TanStack Query 5 + recharts (Precision Dark UI)
packages/shared Zod schemas, types and constants shared by api + web
```

## Quick start (local, no cloud account needed)

```bash
npm install
cp .env.example .env            # then edit the three server values
npm run dev:api:node            # API on :8787 (SQLite file apps/api/.dev/vxqor.sqlite)
npm run dev:web                 # UI on :5173 (proxies /v1 to :8787)
```

Open http://localhost:5173 — the first visit shows the one-time **owner bootstrap**
(requires `VXQOR_BOOTSTRAP_SECRET` from `.env`). If the variable is unset in Node dev,
a clearly logged dev-only default (`dev-bootstrap-secret`) is used.

Cloudflare-native local dev (D1 + cron exactly as deployed):

```bash
npx wrangler d1 create vxqor                 # once; put database_id in wrangler.toml
npm run db:migrate:local
npm run dev:api                              # wrangler dev on :8787
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | API (wrangler) + web concurrently |
| `npm run dev:api:node` | API on Node with SQLite shim + TLS cert probes + 60s scheduler |
| `npm test` | Vitest suite (37 tests: auth, SSRF, monitoring, analytics, keys, e2e) |
| `npm run typecheck` | strict TS across shared/api/web |
| `npm run build` | web production build + api typecheck |
| `npm run db:migrate:local` / `:remote` | apply D1 migrations |

## Authentication model

- One owner, bootstrapped once with a server-side secret. No public signup.
- Passwords: PBKDF2-HMAC-SHA256 (Web Crypto), iterations via `VXQOR_PBKDF2_ITERATIONS`.
- Sessions: 12h, HttpOnly/SameSite cookies, rotation on auth, revocation, device list.
- Optional TOTP MFA (`otpauth`) with 8 single-use recovery codes (stored hashed).
- Login rate limiting (per IP + per email) and lockout after 5 failures.
- CSRF: cookie mutations require the configured web origin; JSON content-type forces CORS preflight.

## Monitoring & SSRF

- Cron (`*/5 * * * *` on Workers; 60s interval on Node dev) checks due monitors.
- Targets validated before any request: scheme/port allowlist, no userinfo, hostname
  blocklist, DoH resolution with rejection of loopback/private/link-local/multicast/
  reserved ranges and cloud-metadata IPs; every redirect hop re-validated.
- Failure threshold → incident (deduped per monitor); recovery auto-resolves.
- Workers Free allows 50 subrequests/invocation → `VXQOR_MAX_CHECKS_PER_RUN` (default 15).

## Analytics

- Per-site public `tracking_id` + served snippet (`/v1/snippet/<id>.js`): pageviews,
  custom events (`window.vxqor.track`), Core Web Vitals (LCP/INP/CLS/FCP/TTFB),
  uncaught errors/unhandled rejections with secret redaction.
- Privacy: no cookies; IPs truncated to /24//48 inside a per-day fingerprint hash and discarded.
- Ingestion: schema validation, per-token rate limits, origin allowlist, dedupe keys.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — diagram, data flow, runtime notes
- [DEPLOYMENT.md](DEPLOYMENT.md) — Vercel + Workers + D1 + cron + bootstrap + backups
- [SECURITY.md](SECURITY.md) — threat model, controls, documented constraints & residual risks
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — phase checklist with verified status

## Verified platform limits (2026-10)

- Workers Free: 100k requests/day, **10ms CPU per invocation**, 50 subrequests/invocation.
- D1 Free: 5M rows read/day, 100k rows written/day, 5GB storage (daily caps enforced).
- Cron Free: 3 triggers/Worker, 1-minute minimum interval.
