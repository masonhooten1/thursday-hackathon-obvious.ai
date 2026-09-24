import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node-environment unit tests for pure modules (fixtures, later services).
// Component tests with jsdom + Testing Library arrive with the traveler-UX task.
export default defineConfig({
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
