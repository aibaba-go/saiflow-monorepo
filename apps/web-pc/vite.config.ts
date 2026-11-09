import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
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
    // Above the 5 s find timeout (setup.ts), so a missing element reports the DOM.
    testTimeout: 15000,
    // Node's Request needs an absolute URL; the browser uses same-origin "" (config.ts).
    env: { VITE_API_BASE_URL: "http://localhost", VITE_LIFF_ID: "test-liff", VITE_LINE_CHANNEL_ID: "1234567890" },
  },
});
