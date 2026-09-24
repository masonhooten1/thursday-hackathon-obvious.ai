import { defineConfig } from "vitest/config";

// Local config so this workspace never inherits the root (extension)
// vitest.config.ts by directory-walk.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
