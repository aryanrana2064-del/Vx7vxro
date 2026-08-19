# VYRO VX7 — Online Deploy (Railway / Render) with local SQLite on a persistent disk

The app runs as ONE web service: FastAPI serves the API **and** the built React UI on a single
port. All data lives in **one local SQLite file** at **`/data/vyro.db`** on a mounted persistent
disk — **no MongoDB, no external database service**. Restarts/redeploys keep the data.

Files that make this work (already in the repo):
- `Dockerfile` — builds the React frontend, then runs the backend serving API + static UI.
- `backend/requirements-deploy.txt` — slim runtime deps (no motor/pymongo/pandas/etc.).
- `render.yaml` — Render web service + 1 GB persistent disk mounted at `/data`.
- `railway.json` — Railway Docker deploy config.
- Backend reads the DB path from `VYRO_DB_PATH` (the Docker image / render.yaml / railway config set it to `/data/vyro.db`).

---
## Option A — Render (recommended, disk config is automatic via render.yaml)
1. Push this repo to GitHub (Emergent: **Save to GitHub**).
2. On Render → **New +** → **Blueprint** → pick your repo. Render reads `render.yaml`.
3. It creates a Docker web service on the **starter** plan with a **1 GB disk mounted at `/data`**.
   Set the `ADMIN_PASSWORD` env var (marked `sync:false`) in the dashboard, then **Deploy**.
4. Open the service URL — the whole app loads. `vyro.db` is created inside `/data` on first run
   and persists across every restart/redeploy.
   > Persistent disks need a paid instance (starter+). The disk pins the service to 1 instance,
   > which is exactly right for a single-file SQLite DB.

## Option B — Railway
1. Push this repo to GitHub → Railway → **New Project → Deploy from GitHub repo**.
   Railway detects the `Dockerfile` / `railway.json`.
2. In the service → **Variables**, add:
   - `VYRO_DB_PATH=/data/vyro.db`
   - `JWT_SECRET=<any long random string>`
   - `ADMIN_EMAIL=admin@vyrovx7.app`, `ADMIN_PASSWORD=<your password>`
   - `CORS_ORIGINS=*`
3. In the service → **Settings → Volumes**, add a volume mounted at **`/data`** (this is the
   persistent storage that keeps `vyro.db` safe across restarts).
4. Deploy. Open the generated domain — the full app runs online, data in `/data/vyro.db`.

---
## Confirm: 100% local file DB, no external database
- The only datastore is `backend/sqlite_db.py` writing to `VYRO_DB_PATH` (`/data/vyro.db`).
- There is **no** MongoDB/Postgres/Atlas connection anywhere. Login credentials, products, sales,
  customers, suppliers, purchases, returns, payments, stock movements, settings, shops, licenses
  and counters are all rows in that one SQLite file.
- First deploy starts empty → open the site → **Create Shop Account** to make your owner login
  (a superadmin `admin@vyrovx7.app` is auto-seeded from env vars).

## Local test of the exact production image (optional)
```bash
docker build -t vyro .
docker run -p 8001:8001 -v vyro_data:/data -e ADMIN_PASSWORD=secret vyro
# open http://localhost:8001
```
