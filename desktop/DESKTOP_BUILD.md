# VYRO VX7 — Windows Desktop (.exe) — Fully Offline, Local SQLite Database

The app now uses a **single local SQLite file** (no MongoDB, no database server, no internet).
Everything — products, sales, customers, suppliers, purchases, returns, payments, stock movements,
settings, users, licenses, counters — lives in one file: **`vyro.db`**.

- On Windows the DB is created automatically at **`%LOCALAPPDATA%\VyroVX7\vyro.db`** (first run).
- The FastAPI backend **also serves the built React UI** from the same process/port, so the whole
  app is one `VyroVX7.exe`. Launching it opens your browser at `http://127.0.0.1:8001`.
- 100% offline: adding/editing products, billing, stock, printing, reports — none need a connection.
- Data persists across restarts and is never wiped if a license expires.

## Option A — Build the .exe automatically with GitHub Actions (easiest)
1. Push this project to GitHub (Emergent: **Save to GitHub**). The workflow file
   `.github/workflows/build-windows.yml` goes with it.
2. On GitHub, open the **Actions** tab → select **"Build Windows EXE (VyroVX7)"** →
   click **Run workflow** (manual `workflow_dispatch` trigger).
3. When it finishes (~5–8 min), open that run → **Artifacts** → download **`VyroVX7-Windows`**.
   Inside is **`VyroVX7.exe`** — copy it to any Windows laptop and double-click. Done, fully offline.

The workflow: builds the React frontend (`yarn build`), installs backend deps, then runs PyInstaller
`--onefile` to bundle the backend + `sqlite_db.py` + `templates.py` + the frontend build into a single
`VyroVX7.exe`, and uploads it as an artifact.

## Option B — Build the .exe locally on a Windows machine
Prereqs: Node.js 18+, Python 3.11+.
```bat
cd frontend
set REACT_APP_BACKEND_URL=
yarn install
yarn build

cd ..\backend
pip install -r requirements.txt pyinstaller
pyinstaller --onefile --clean --name VyroVX7 ^
  --add-data "templates.py;." ^
  --add-data "sqlite_db.py;." ^
  --add-data "..\frontend\build;frontend_build" ^
  --collect-all uvicorn ^
  --hidden-import email_validator --hidden-import bcrypt ^
  run_desktop.py
```
Output: **`backend\dist\VyroVX7.exe`** — a single offline app.

## First login on the desktop app
The desktop DB starts empty. Open the app → **Create Shop Account** to make your owner login
(set a security hint so you can recover the password offline). A platform admin
(`admin@vyrovx7.app` / `VXROVX7`) is auto-seeded too.

## Moving data between laptop and phone (both offline)
Use **Import / Export → Backup Now** to export one data file, transfer it via USB / local Wi-Fi /
Bluetooth, and **Restore** on the other device. No internet required.

## Notes
- Emergent (this cloud environment) builds web apps and cannot compile a Windows `.exe` itself —
  use Option A (GitHub Actions, recommended) or Option B (your Windows PC).
- The web/cloud preview and the desktop exe run the **same code**; only where the SQLite file lives
  differs (set by `VYRO_DB_PATH`, defaulting to the OS app-data folder on desktop).
