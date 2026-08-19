"""VYRO VX7 desktop launcher — runs the FastAPI backend (with SQLite local DB) and serves
the built React frontend from the same process/port, then opens the default browser.

Fully offline: no MongoDB, no internet, no separate DB server. Data lives in a single local
file (vyro.db) under the OS app-data folder (e.g. %LOCALAPPDATA%/VyroVX7/vyro.db on Windows).
Packaged into a single VyroVX7.exe by PyInstaller (see .github/workflows/build-windows.yml).
"""
import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8001


def base_dir() -> Path:
    """Folder that holds bundled resources (templates.py, frontend build)."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)  # PyInstaller onefile extraction dir
    return Path(__file__).parent


def data_dir() -> Path:
    """Writable per-user folder for the local database file."""
    if os.name == "nt":
        root = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    d = root / "VyroVX7"
    d.mkdir(parents=True, exist_ok=True)
    return d


# Configure environment BEFORE importing the FastAPI app
os.environ.setdefault("VYRO_DB_PATH", str(data_dir() / "vyro.db"))
os.environ.setdefault("VYRO_FRONTEND_DIR", str(base_dir() / "frontend_build"))
os.environ.setdefault("JWT_SECRET", "vyro-vx7-local-desktop-secret")
os.environ.setdefault("ADMIN_EMAIL", "admin@vyrovx7.app")
os.environ.setdefault("ADMIN_PASSWORD", "VXROVX7")
os.environ.setdefault("CORS_ORIGINS", "*")

# Make sure the bundled backend modules are importable
sys.path.insert(0, str(base_dir()))

import uvicorn  # noqa: E402
from server import app  # noqa: E402


def _open_browser():
    time.sleep(2.0)
    try:
        webbrowser.open(f"http://{HOST}:{PORT}")
    except Exception:
        pass


if __name__ == "__main__":
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
