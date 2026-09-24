import { defineConfig } from "vitest/config";

// Local config so this workspace never inherits the root (extension)
// vitest.config.ts by directory-walk — its include pattern matches nothing here.
export default defineConfig({
  test: {
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.expo/**", "**/dist/**"],
  },
});
