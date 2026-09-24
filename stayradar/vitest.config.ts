import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node-environment unit tests for pure modules (fixtures, later services).
// Component tests with jsdom + Testing Library arrive with the traveler-UX task.
export default defineConfig({
  // Tailwind v4's postcss.config.mjs plugin shape breaks Vite 5's eager
  // PostCSS resolution; tests are node-env and import no CSS, so run Vite
  // with an explicit empty inline PostCSS config instead of the file.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
