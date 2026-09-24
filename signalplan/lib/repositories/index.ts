import "server-only";
import { PostgresRepository } from "./postgres";

/** Production repository singleton for route files and workers. */
export const defaultRepository = new PostgresRepository();
export type { SignalPlanRepository, CompanyAuditBundle, CreateRunResult } from "./types";
export { PostgresRepository } from "./postgres";
export { InMemoryRepository, type InMemoryTables } from "./in-memory";
