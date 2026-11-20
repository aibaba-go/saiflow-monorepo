import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin /api in development, like Caddy in deployment. SAIFLOW_API_PROXY points it
    // at another local API (scripts/dev: 127.0.0.1:8010, since 8000 may be taken). The browser's
    // Host is kept, as Caddy does, so the dev login can tell this machine from the LAN (NFR-DEV-002).
    proxy: {
      "/api": { target: process.env.SAIFLOW_API_PROXY ?? "http://localhost:8000", changeOrigin: false },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    // like web-pc and web-admin: under `pnpm -r test` the three suites share the CPU
    testTimeout: 15000,
    // Node's Request needs an absolute URL; the browser uses same-origin "" (config.ts).
    env: { VITE_API_BASE_URL: "http://localhost" },
    // CSS modules keep their source class names in tests, so tests can name a state class.
    css: { include: [/\.module\.css$/], modules: { classNameStrategy: "non-scoped" } },
  },
});
