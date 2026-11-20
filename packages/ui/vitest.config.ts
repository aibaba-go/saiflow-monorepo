import { defineConfig } from "vitest/config";

// Two projects: the token / font checks read files from disk and run in Node (as before);
// the React components run in jsdom with Testing Library.
export default defineConfig({
  test: {
    globals: true,
    // like the apps: under `pnpm -r test` the suites share the CPU
    testTimeout: 15000,
    projects: [
      {
        extends: true,
        test: { name: "node", environment: "node", include: ["src/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/components/**/*.test.{ts,tsx}"],
          setupFiles: "./src/test/setup.ts",
        },
      },
    ],
  },
});
