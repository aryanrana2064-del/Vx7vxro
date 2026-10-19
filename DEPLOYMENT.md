# Deployment Guide

Free-tier targets: **Vercel** (frontend) + **Cloudflare Workers/D1** (API + scheduler).
Nothing here creates paid resources automatically; verify plan limits before relying on them.

## 0. Prerequisites

- Node ≥ 22, npm ≥ 10
- Cloudflare account (Workers + D1), Vercel account
- Values to generate now (keep secret):
  ```bash
  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # bootstrap secret
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"        # encryption key
  ```

## 1. Database (D1)

```bash
npx wrangler login
npx wrangler d1 create vxqor
# copy the printed database_id into apps/api/wrangler.toml → [[d1_databases]].database_id
npm run db:migrate:remote        # applies migrations/0001_init.sql + 0002_dedupe_index.sql
```

Local equivalent: `npm run db:migrate:local`.

## 2. Worker (API + cron)

Set secrets/vars on the Worker (dashboard or `wrangler secret put`):

| Variable | Secret? | Notes |
| --- | --- | --- |
| `VXQOR_WEB_ORIGIN` | no | exact Vercel origin, e.g. `https://vxqor.vercel.app` |
| `VXQOR_BOOTSTRAP_SECRET` | **yes** | one-time owner bootstrap; rotate/delete after bootstrap |
| `VXQOR_ENCRYPTION_KEY` | **yes** | 64 hex chars; integration tokens at rest |
| `VXQOR_PBKDF2_ITERATIONS` | no | keep ≥ 210000 on Workers Paid; see SECURITY.md for Free-tier note |
| `VXQOR_MAX_CHECKS_PER_RUN` | no | ≤ 15 on Free (50 subrequests/invocation) |
| `VXQOR_RETENTION` | no | optional `table:days,...` overrides |

```bash
cd apps/api
npx wrangler deploy          # deploys fetch + scheduled() handler; cron from wrangler.toml
```

Verify: `curl https://<worker>/v1/health` and `/v1/system/state`
(`bootstrapRequired: true`, `scheduler.lastRunAt` updates every 5 minutes).

## 3. Frontend (Vercel)

Order matters: deploy the API Worker first so the Vercel origin can be allowlisted and
the same-origin rewrite can point at a real URL.

1. **API first** (section 2). Use worker name `vxqor-api-v2` (already set in
   `apps/api/wrangler.toml`) so your existing token-gated `vxqor-api` Worker is never
   replaced. Before applying migrations to the shared `vxqor-db`, inspect its current
   tables so nothing collides (migrations are `IF NOT EXISTS`-guarded, but a pre-existing
   table with a different shape would be skipped and must be reconciled):
   ```bash
   npx wrangler d1 execute vxqor-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
   ```
2. **Link + deploy the web**:
   ```bash
   npx vercel login                 # once, interactive
   npx vercel link                  # at repo root; vercel.json sets build/output paths
   npx vercel env add VITE_API_BASE_URL production   # leave EMPTY for same-origin rewrite
   npx vercel --prod
   ```
   `vercel.json` (repo root) builds the `@vxqor/web` workspace and outputs `apps/web/dist`.
3. **Same-origin API (recommended)**: after step 1 gives you `https://vxqor-api-v2.<sub>.workers.dev`,
   add a rewrite so cookies stay first-party and no CORS is involved:
   ```json
   { "source": "/v1/:path*", "destination": "https://vxqor-api-v2.<sub>.workers.dev/v1/:path*" }
   ```
   append it to `vercel.json.rewrites`, redeploy, and set the Worker var
   `VXQOR_WEB_ORIGIN=https://<your-vercel-domain>` (required by the origin/CSRF guard).
   Cross-origin alternative: skip the rewrite, set `VITE_API_BASE_URL=https://vxqor-api-v2…`
   and the same `VXQOR_WEB_ORIGIN`; cookies then travel `SameSite=None; Secure`.
4. Bootstrap the owner at `https://<your-vercel-domain>/setup`, then enroll MFA.

No secret ever goes into `VITE_*`: `VITE_API_BASE_URL` is a public URL only. The remote
registry token (`VXQOR_REMOTE_API_TOKEN`) lives exclusively in the API process/Worker secrets.

## 4. Owner bootstrap + MFA

1. Open the deployed UI → `/setup`. Enter the bootstrap secret, owner email, password (≥12 chars).
2. Settings → Enroll MFA: scan/enter the TOTP secret, confirm a 6-digit code, store the 8 recovery codes offline.
3. Delete/rotate `VXQOR_BOOTSTRAP_SECRET` on the Worker (bootstrap endpoint is dead after an owner exists anyway).

## 5. Instrument a website

Websites → Register website (list the domains you authorize) → copy the snippet from the
site detail page into your pages. Ingestion, Core Web Vitals and error capture start
immediately; analytics stay empty until real events arrive.

## 6. CI deployment records + integrations

- Create an API key with `deployments:write` (Settings → API Keys); post from CI:
  `POST /v1/deployments` with `Authorization: Bearer vxqor_…`.
- Integrations page: GitHub (fine-grained token, Contents+PRs read) and Vercel tokens are
  validated on save and encrypted at rest; alert webhooks are HMAC-signed when a secret is set.

## 7. Backups & restore

```bash
npx wrangler d1 export vxqor --remote --output=backup.sql     # backup
npx wrangler d1 execute vxqor --remote --file=backup.sql      # restore (destructive: confirm first)
```
D1 Time Travel (7 days Free / 30 days Paid) covers accidental writes.

## 8. Connected Cloudflare deployment (production registry)

The deployed Worker `https://vxqor-api.aryanrana2064.workers.dev` owns the production
D1 database **vxqor-db** (binding `DB`). `apps/api/wrangler.toml` references the same
binding/database name — fill the real `database_id` once with:

```bash
npx wrangler login
npx wrangler d1 list                      # copy the id of vxqor-db into wrangler.toml
```

The web UI lists/creates websites through a **server-side proxy** in `apps/api`
(`GET|POST /v1/remote/websites`, `GET /v1/remote/status`). The remote API token is
attached only inside the Worker/Node process:

```bash
# local dev (apps/api/.env or root .env — both gitignored)
VXQOR_REMOTE_API_URL=https://vxqor-api.aryanrana2064.workers.dev
VXQOR_REMOTE_API_TOKEN=<token>

# deployed Worker
npx wrangler secret put VXQOR_REMOTE_API_TOKEN
```

Never place the token in `VITE_*` variables, browser storage or frontend code. When the
token is absent or rejected, the Websites page falls back to the local registry and shows
a badge explaining the source.

Verify the round-trip (server-side, token never leaves the process):

```bash
curl -s -b cookies.txt http://localhost:8787/v1/remote/status
curl -s -b cookies.txt http://localhost:8787/v1/remote/websites
curl -s -b cookies.txt -X POST http://localhost:8787/v1/remote/websites \
  -H 'content-type: application/json' -d '{"name":"Probe","domains":["probe.example.com"]}'
# confirm the row landed in the intended database:
npx wrangler d1 execute vxqor-db --remote --command="SELECT id, name FROM websites ORDER BY rowid DESC LIMIT 5"
```

## 9. Troubleshooting

| Symptom | Check |
| --- | --- |
| UI stuck on "Scheduler stale" | Worker cron enabled? `/v1/system/state.scheduler`; D1 daily caps not exceeded |
| Login 429 | rate-limit window (15 min); check security events |
| CORS/cookie errors | `VXQOR_WEB_ORIGIN` equals UI origin exactly; HTTPS both sides |
| Monitor `ssrf_blocked` | target resolves to a private/loopback/metadata range — intended |
| `encryption_not_configured` | set `VXQOR_ENCRYPTION_KEY` and redeploy |
| D1 quota errors | Free daily caps enforced since 2026-09; reduce retention/interval or upgrade |

## 9. Local development recap

```bash
npm install
cp .env.example .env
npm run dev:api:node & npm run dev:web     # or: npm run dev (wrangler + vite)
npm test && npm run typecheck && npm run build
```
