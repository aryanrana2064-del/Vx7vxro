// VYRO VX7 — Electron desktop shell (Windows .exe, offline-capable)
// Strategy:
//  1. Starts the bundled Python FastAPI backend (packaged with PyInstaller as backend/vyro-backend.exe)
//     which serves the API and connects to a LOCAL MongoDB (mongodb://127.0.0.1:27017).
//  2. Loads the production React build (app/index.html) — a fully offline static bundle.
//  The React app talks to http://127.0.0.1:8001, so everything runs on the device with no internet.
//  See DESKTOP_BUILD.md for how to produce the backend .exe and local Mongo, then `npm run dist`.

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

let backendProc = null;
let win = null;
const BACKEND_URL = "http://127.0.0.1:8001";

function resourcePath(...p) {
  // In a packaged app, extraResources live under process.resourcesPath
  const base = app.isPackaged ? process.resourcesPath : __dirname;
  return path.join(base, ...p);
}

function startBackend() {
  const exe = process.platform === "win32" ? "vyro-backend.exe" : "vyro-backend";
  const backendExe = resourcePath("backend", exe);
  try {
    backendProc = spawn(backendExe, [], {
      cwd: resourcePath("backend"),
      env: {
        ...process.env,
        MONGO_URL: process.env.MONGO_URL || "mongodb://127.0.0.1:27017",
        DB_NAME: process.env.DB_NAME || "vyro_vx7",
        JWT_SECRET: process.env.JWT_SECRET || "vyro-vx7-local-desktop-secret",
        CORS_ORIGINS: "*",
        PORT: "8001",
      },
      stdio: "ignore",
      windowsHide: true,
    });
    backendProc.on("error", (e) => console.error("Backend failed to start:", e));
  } catch (e) {
    console.error("Could not spawn backend (run in web mode?):", e);
  }
}

function waitForBackend(cb, tries = 0) {
  http
    .get(`${BACKEND_URL}/api/`, () => cb())
    .on("error", () => {
      if (tries > 40) return cb(); // give up waiting, load UI anyway
      setTimeout(() => waitForBackend(cb, tries + 1), 500);
    });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b1120",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  startBackend();
  waitForBackend(createWindow);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (backendProc) try { backendProc.kill(); } catch (e) {}
  if (process.platform !== "darwin") app.quit();
});
