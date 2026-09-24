import { createDb, resolveDatabaseUrl, type StayRadarDb } from "@/db";

/**
 * Lazy shared connection for the campaign route handlers. Service functions
 * take a `db` parameter (tests pass their own); only the thin route adapters
 * use this process-wide singleton so a pool is not created per request.
 */
let cached: (StayRadarDb & { $client: { end(): Promise<void> } }) | null = null;

export function getMarketingDb(): StayRadarDb & { $client: { end(): Promise<void> } } {
  return (cached ??= createDb(resolveDatabaseUrl()));
}
