import { defineConfig } from "vitest/config";

// Root tooling serves the Chrome extension (repo root). The Next.js app in web/
// has its own vitest config and JSX tests — keep root Vitest from scanning it.
export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.*", "tests/**/*.{test,spec}.*"],
  },
});
