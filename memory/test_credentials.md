# Test Credentials

> NOTE: The backend now uses a local **SQLite** file (`backend/vyro.db`) instead of MongoDB.
> The DB starts empty on a fresh environment — the accounts below were re-created via signup.

## Shop Owner (primary)
- Email: aryanrana2064@gmail.com
- Password: aryan123
- Role: Owner (full access)
- Security hint: "First school name" · answer: dps

## Shop Owner (secondary)
- Email: owner@euue.com
- Password: euue123
- Role: Owner · Business: Euue Store

## Platform Superadmin (auto-seeded on startup)
- Email: admin@vyrovx7.app
- Password: VXROVX7
- Lands on /admin

Notes: JWT auth, token in localStorage key `jbx_token`. Frontend api base = REACT_APP_BACKEND_URL + /api
(empty => same-origin /api, used by the offline desktop exe). Theme in localStorage `vyro_theme`.
If a test needs data, sign up a fresh shop (accounts persist in vyro.db).
