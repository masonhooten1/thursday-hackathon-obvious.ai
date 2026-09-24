import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": rootDir,
      // Keep the "never in the client bundle" guard active in builds while
      // letting vitest import server modules directly.
      "server-only": path.resolve(rootDir, "tests/stubs/server-only.ts"),
    },
  },
});
