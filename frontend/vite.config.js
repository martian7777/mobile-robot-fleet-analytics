import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend (FastAPI) serves the built SPA from its own `static/` directory and
// mounts it at `/static`. So in production the app is served under `/static/` and
// index.html is returned at `/`. We build straight into ../backend/static so the
// existing single-port (:8000) Docker deployment keeps working unchanged.
//
// In dev we run on Vite's own port and proxy REST + WebSocket traffic to the
// backend on :8000.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Assets are referenced from /static/... in production, root in dev.
  base: command === "build" ? "/static/" : "/",
  build: {
    outDir: "../backend/static",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
      "/healthz": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
}));
