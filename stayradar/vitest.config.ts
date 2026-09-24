import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node-environment unit tests for pure modules (fixtures, contracts, helpers)
// and DB-backed integration files; component tests under tests/components/
// run in jsdom with Testing Library (traveler-UX task).
export default defineConfig({
  // Tailwind v4's postcss.config.mjs plugin shape breaks Vite 5's eager
  // PostCSS resolution; tests import no processed CSS (Vitest stubs CSS
  // imports), so run Vite with an explicit empty inline PostCSS config
  // instead of the file.
  css: { postcss: { plugins: [] } },
  // tsconfig sets jsx: "preserve" for Next's SWC compiler; Vitest transpiles
  // with esbuild, which needs the automatic runtime to inject React imports.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    environmentMatchGlobs: [["tests/components/**", "jsdom"]],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // DB-backed integration files truncate shared tables in beforeAll; run
    // files one at a time so one file's TRUNCATE can never land mid-suite of
    // another's (unit + component files are unaffected — the run stays fast).
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
