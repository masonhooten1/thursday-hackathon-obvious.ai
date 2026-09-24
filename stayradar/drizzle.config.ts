import { defineConfig } from "drizzle-kit";

// Migration workflow: `pnpm --dir stayradar db:generate` after editing
// src/db/schema.ts, then check the generated folder under drizzle/ into git.
// Applying runs through src/db/apply-migrations.ts (which also enables
// PostGIS) via `db:migrate` — drizzle-kit apply alone would miss that step.
//
// Known quirk: drizzle-kit double-quotes custom-type names, emitting
// `"geography(point, 4326)"` which Postgres rejects. After each generate,
// unquote the type in any new CREATE/ALTER statements (identifier quoting for
// column names stays). The snapshot records the type unquoted, so diffs stay
// stable.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
