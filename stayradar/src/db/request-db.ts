import { createDb, resolveDatabaseUrl, type StayRadarDb } from "./index";

/**
 * Request-scoped db accessor for route handlers.
 *
 * Services take a db handle as their first argument (searchable, injectable
 * in tests); route handlers are not dependency-injected, so they draw one
 * from here. The pool is created lazily — never at module import, so
 * `next build` never needs a database — and cached on globalThis so Next.js
 * dev-server hot reloads reuse the same pool instead of leaking one per
 * reload (the documented Next.js singleton pattern).
 */
const globalForDb = globalThis as unknown as { __stayRadarDb?: StayRadarDb };

export function getRequestDb(): StayRadarDb {
  if (!globalForDb.__stayRadarDb) {
    globalForDb.__stayRadarDb = createDb(resolveDatabaseUrl());
  }
  return globalForDb.__stayRadarDb;
}
