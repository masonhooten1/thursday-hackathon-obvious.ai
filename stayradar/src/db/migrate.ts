import { applyMigrations } from "./apply-migrations";
import { createDb, resolveDatabaseUrl } from "./index";

/** CLI wrapper for `pnpm --dir stayradar db:migrate`. Idempotent. */
async function main(): Promise<void> {
  const db = createDb(resolveDatabaseUrl());
  try {
    await applyMigrations(db);
    console.log("Migrations applied.");
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
