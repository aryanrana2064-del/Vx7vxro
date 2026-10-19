# VXQOR Security Notes

Scope: private single-owner platform. This document lists implemented controls,
documented constraints and residual risks. It is not a penetration-test report.

## Implemented controls

**Authentication & sessions**
- One-time owner bootstrap gated by server-side `VXQOR_BOOTSTRAP_SECRET`; rejected forever after an owner exists.
- PBKDF2-HMAC-SHA256 via Web Crypto (platform primitive), 16-byte random salt, iterations configurable (default 210k).
- Sessions: 256-bit random tokens, stored as SHA-256 hashes, 12h expiry, HttpOnly + SameSite cookie (`None; Secure` off-localhost, `Lax` on localhost), rotation on authentication, per-session revocation + revoke-others.
- Optional TOTP MFA (`otpauth`, RFC 6238, ±1 window) and 8 single-use recovery codes stored as SHA-256 hashes.
- Login rate limits: 10 attempts/15min per IP and 8/15min per email (D1-backed fixed windows); account lockout 15min after 5 failures; generic `invalid_credentials` for unknown accounts with dummy-hash verify to reduce timing leakage.
- Re-authentication (password) required for MFA disable and recovery-code regeneration; recovery regeneration additionally requires an MFA-verified session.
- CSRF: mutations carrying the session cookie must present the configured web origin (or same host); JSON content-type forces CORS preflight against a strict allowlist with credentials.

**Authorization**
- Server-side enforcement on every private route: session middleware or scope-checked API keys. UI hiding is never relied upon.
- API keys: CSPRNG secrets (`vxqor_…`), SHA-256 hash at rest, prefix for display, shown once, scopes enforced per route, expiry + revocation enforced, rotation revokes the old key, hourly usage accounting.

**Monitoring / SSRF**
- Scheme allowlist (http/https), port allowlist (80/443/8080/8443), userinfo rejected.
- Hostname blocklist (localhost, .local, .internal, metadata hosts) and DoH pre-resolution with rejection of loopback, private, CGNAT, link-local (incl. 169.254.169.254), multicast, reserved, documentation and benchmark ranges; IPv6 ULA/link-local/multicast and IPv4-mapped forms covered; unparsable literals fail closed.
- Redirects handled manually; every hop re-validated through the same pipeline; hop count bounded; total request timeout bounded; response body read capped at 256KB.
- Unsafe targets rejected at monitor creation and again at check time.

**Ingestion privacy & abuse**
- No cookies; no raw IP storage (truncated /24//48 inside a per-day salted fingerprint, then discarded).
- Per-token fixed-window rate limits; origin allowlist per registered domain; bounded batches (≤50 events); dedupe via partial unique index; error messages/stacks scrubbed of credential-like patterns before storage.

**Data protection**
- Integration tokens encrypted at rest (AES-256-GCM) with key from `VXQOR_ENCRYPTION_KEY`; refused (409) when unset.
- Audit trail for privileged actions; security events for auth failures, MFA failures, SSRF rejections, DNS changes, cert warnings, incident transitions.
- Structured server logs redact secret-named fields; exports never include secrets.

## Documented constraints

- **Password hashing on Workers Free**: the Free plan allows 10ms CPU per invocation, which cannot sustain OWASP-grade server-side PBKDF2. Production should run Workers Paid ($5/mo, 30s CPU) or the bundled Node scheduler; alternatively lower `VXQOR_PBKDF2_ITERATIONS` consciously — compensating controls (rate limits, lockout, MFA, rotation) remain active. Argon2id is not viable on Workers (no native support, CPU/memory caps); PBKDF2-SHA256 is the documented supported alternative.
- **TLS certificate inspection**: Cloudflare Workers cannot read peer certificates; `ssl_expiry` checks report `unavailable` on Workers and run only on the Node scheduler (`node:tls`).
- **Cron granularity**: Free plan minimum interval is 1 minute and 3 triggers/Worker; default cadence is 5 minutes and per-run check counts are capped by the 50-subrequest limit. Continuous per-minute monitoring is not promised.
- **Unique visitors** are estimates (fingerprint-based); bots, blockers and consent reduce measurement. Pageviews, sessions and estimates are labelled distinctly in the UI.

## Residual risks

- DNS rebinding between validation and fetch cannot be fully pinned on Workers (no socket-level control); mitigated by pre-validation, short windows, redirect re-validation and hop limits. The Node scheduler shares this limitation.
- SameSite=Lax on localhost dev relies on the Vite proxy keeping origins identical; cross-origin production setups should use SameSite=None over TLS (automatic off-localhost).
- Webhook alert delivery is best-effort (5s timeout, no retry queue); failures are logged, and the UI shows when notifications are not configured.
- The owner bootstrap secret must be delivered out-of-band; anyone holding it before bootstrap can create the owner account.
