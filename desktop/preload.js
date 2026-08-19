// Minimal preload — the React build points at http://127.0.0.1:8001 via its build-time env.
// Exposes the local backend URL for any renderer code that needs it.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("vyroDesktop", {
  isDesktop: true,
  backendUrl: "http://127.0.0.1:8001",
  platform: process.platform,
});
