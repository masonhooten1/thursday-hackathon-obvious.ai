import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { StayRadarDb } from "./index";

/** stayradar/drizzle — the drizzle-kit output folder, checked in. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle/", import.meta.url));

/**
 * Prepare a database for StayRadar: enable PostGIS, then apply the checked-in
 * drizzle migrations. Safe to run repeatedly (extension creation is
 * IF NOT EXISTS; the migrator tracks applied migrations).
 *
 * Requires a superuser role for the extension step — true for the CI
 * postgis/postgis:16 service and for the documented local setup.
 */
export async function applyMigrations(db: StayRadarDb): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Delete all rows — test isolation between cases (schema stays). */
export async function truncateAll(db: StayRadarDb): Promise<void> {
  await db.execute(
    sql`TRUNCATE leads, campaigns, search_events, availability, properties CASCADE`,
  );
}
