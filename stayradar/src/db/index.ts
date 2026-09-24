import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema";

export type StayRadarDb = NodePgDatabase<typeof schema>;

/**
 * Create a Drizzle db over node-postgres. One pool per call — callers own the
 * lifecycle (seed/CLI owns the process pool; tests use one per worker) and
 * close it via db.$client.end().
 */
export function createDb(connectionString: string): StayRadarDb & { $client: Pool } {
  return drizzle(connectionString, { schema });
}

/**
 * Resolve the connection string for the current environment. Integration
 * tests point TEST_DATABASE_URL at an isolated database; local/production
 * paths fall back to DATABASE_URL.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.TEST_DATABASE_URL ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "No database configured: set TEST_DATABASE_URL (integration tests) or DATABASE_URL. " +
        "See stayradar/README.md for the Postgres 16 + PostGIS setup.",
    );
  }
  return url;
}
