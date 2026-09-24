/**
 * Seed CLI — `pnpm --dir stayradar db:seed`.
 *
 * Idempotent: applies migrations (no-ops when current), then upserts the 40
 * curated fixture properties with their deterministic 90-day availability
 * calendars on (source, external_id) — re-running never duplicates rows.
 */
import { createDb, resolveDatabaseUrl } from "@/db";
import { applyMigrations } from "@/db/apply-migrations";
import { ingestProperties } from "@/lib/services/ingestion/ingest";
import { SeedConnector } from "@/lib/services/ingestion/seed-connector";

async function main(): Promise<void> {
  const databaseUrl = resolveDatabaseUrl();
  const db = createDb(databaseUrl);
  try {
    await applyMigrations(db);
    const inputs = new SeedConnector().load();
    const summary = await ingestProperties(db, inputs);
    const markets = new Set(inputs.map((input) => input.market)).size;
    process.stdout.write(
      `Seeded ${summary.propertiesUpserted} properties across ${markets} markets ` +
        `(${summary.availabilityRows} availability nights).\n`,
    );
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
