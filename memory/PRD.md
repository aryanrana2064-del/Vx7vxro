# VYRO VX7 — Smart Business POS (PRD)

## Original Problem Statement
Migrate + improve an existing inventory/billing/POS web app (VYRO-VX7). Fix bugs, simplify Products
form, add inventory features, iOS-glass UI + Cinzel + dark/light, reports/roles/returns/backup,
reworked login with password hint, offline Windows .exe + mobile with a LOCAL file database.

## User Choices (confirmed)
- Auth: email+password JWT + security-hint recovery + roles.
- Reports export: PDF + Excel.
- Preserve/migrate existing code (done).
- Replace MongoDB entirely with local SQLite; single offline .exe that also serves the UI and opens
  the browser; GitHub Actions workflow to build the .exe (manual trigger, uploads artifact).

## Architecture
- React (CRA+craco) + FastAPI. **Data layer = local SQLite via a Mongo-compatible shim** (`backend/sqlite_db.py`).
  No MongoDB/Motor. Single DB file `vyro.db` (desktop: %LOCALAPPDATA%/VyroVX7/vyro.db via VYRO_DB_PATH).
- FastAPI serves the React build (SPA catch-all) when VYRO_FRONTEND_DIR/BUILD_DIR exists → single-process/exe.
- JWT Bearer in localStorage (`jbx_token`). api base empty => same-origin /api (used by exe).
- Desktop: `backend/run_desktop.py` starts uvicorn + opens browser; PyInstaller onefile.
- CI: `.github/workflows/build-windows.yml` (workflow_dispatch) builds VyroVX7.exe artifact.

## Implemented (verified)
### Round 1 — iteration_1 100%
- Migrated app; Products form redesign (removed Subcategory/Discount/MRP/Opening Stock/Location);
  inline "+ Add New" Brand/Category/Unit; live Qty×Price calculator; Quick Stock Update page;
  low-stock bell + chime; Cinzel branding; logo in sidebar.
### Round 2 — iteration_2 100% (backend 14/14)
- Dark/Light theme toggle (persisted, iOS-glass); password recovery (security hint/answer, offline)
  + Change Password; Returns/Refunds from a bill (auto-restock, RET- number, print receipt); alt logo.
- Electron desktop scaffold (superseded by SQLite single-exe below).
### Round 3 — MongoDB → SQLite (offline single-exe)
- `sqlite_db.py`: Mongo/Motor-compatible async shim (find/find_one/insert/update/delete/count/distinct/
  find_one_and_update; $set/$inc/$push; $ne/$in/$gt/$gte/$lt/$lte; exclusion projections; sort).
- server.py swapped to SQLite; oid() -> secrets.token_hex(12); removed bson/motor; serves React build
  via SPA catch-all; shutdown closes db.
- run_desktop.py rewritten (SQLite path in OS app-data, serves UI, opens browser).
- GitHub Actions build-windows.yml + desktop/DESKTOP_BUILD.md.
- requirements.txt: removed motor + pymongo.
- Curl-verified on SQLite: signup, login, forgot/reset, change-password, products, stock adjust,
  sales (INV-0001), returns (RET-0001, restock correct 18), dashboard, day-close, categories.
- Single-process static serving verified (root/asset/SPA-fallback OK; /api not shadowed).

## Test Credentials
- Owner: aryanrana2064@gmail.com / aryan123 (hint: First school name / dps)
- Owner: owner@euue.com / euue123 · Superadmin: admin@vyrovx7.app / VXROVX7

## Deliverable
- Full project ZIP served at /VYRO-VX7-export.zip (from frontend/public). Includes .github workflow,
  backend (SQLite), desktop docs.

## Backlog
### P1: Reports PDF/Excel export; wire alt logo + company details into printed receipts/invoices.
### P2: Backup/Restore round-trip verify; PWA install polish; Bluetooth/USB native print (desktop only).

## Next Tasks
- Reports PDF/Excel export; branded receipts; verify Backup & Restore.
