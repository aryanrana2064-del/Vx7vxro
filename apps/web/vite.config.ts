import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin in development: avoids cross-site cookie issues locally.
      "/v1": {
        target: process.env.VITE_PROXY_TARGET ?? "http://localhost:8787",
        changeOrigin: false,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
