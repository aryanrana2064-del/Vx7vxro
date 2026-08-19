# VYRO VX7 — single-image deploy for Railway / Render
# Builds the React frontend, then runs the FastAPI backend which serves BOTH the API and the
# static frontend on one port. Data lives in a single local SQLite file at /data/vyro.db
# (mount a persistent disk/volume at /data). No MongoDB / external database.

# ---------- Stage 1: build the React frontend ----------
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile
COPY frontend/ ./
# Empty backend URL => UI calls same-origin /api (served by the backend below)
ENV REACT_APP_BACKEND_URL=""
RUN yarn build

# ---------- Stage 2: backend runtime ----------
FROM python:3.11-slim AS runtime
WORKDIR /app

COPY backend/requirements-deploy.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Backend source (server.py, sqlite_db.py, templates.py, etc.)
COPY backend/ ./
# Built frontend from stage 1
COPY --from=frontend /fe/build ./frontend_build

ENV VYRO_FRONTEND_DIR=/app/frontend_build \
    VYRO_DB_PATH=/data/vyro.db \
    CORS_ORIGINS="*" \
    PORT=8001

# Persistent SQLite lives here — mount a disk/volume at /data on Railway/Render
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8001
# $PORT is provided by Railway/Render at runtime
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8001}"]
