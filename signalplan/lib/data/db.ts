import "server-only";
import { Pool } from "pg";

/**
 * Server-side Postgres connection (Supabase Postgres via its pooler in
 * production; local Postgres in development). Service-role credentials come
 * from the environment and this module is server-only — the browser bundle
 * never sees them. Workers share the same DATABASE_URL through the
 * service-role connection, bypassing RLS by role grants.
 */

declare global {
  // Keep one pool across serverless invocations.
  var __signalplanPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured. Set the Supabase (or local Postgres) connection string before using persistence.",
    );
  }
  globalThis.__signalplanPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });
  return globalThis.__signalplanPool;
}
