import { defineConfig } from "@trigger.dev/sdk/v3";
import { playwright } from "@trigger.dev/build/extensions/playwright";

export default defineConfig({
  // Real value comes from the Trigger.dev dashboard (TRIGGER_PROJECT_REF);
  // the placeholder keeps credential-free builds and CLI dev runs working.
  project: process.env.TRIGGER_PROJECT_REF ?? "dev-project-placeholder",
  // v4 requires a global ceiling; batch waits on company fan-out, company
  // jobs stay minutes-scale (spec §Performance you should expect).
  maxDuration: 600,
  dirs: ["./trigger"],
  retries: {
    default: { maxAttempts: 3, minTimeoutInMs: 2_000, maxTimeoutInMs: 15_000 },
  },
  // Playwright renders only pages that need it and prints the two-page PDF
  // export; chromium-only keeps builds lean.
  build: {
    extensions: [playwright({ browsers: ["chromium"], headless: true })],
  },
});
