import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    // Same-origin /api in development, like Caddy in deployment.
    proxy: { "/api": "http://localhost:8000" },
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
