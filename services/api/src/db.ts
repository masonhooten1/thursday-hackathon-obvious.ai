import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

/**
 * Opens the snapshot store in WAL mode so poller writes and API reads do not
 * block each other. Creates parent directories — the db path is configurable.
 */
export function openDb(filePath: string): Db {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  // Catalog rows reference parks; without this pragma SQLite silently
  // accepts orphaned campground rows.
  db.pragma("foreign_keys = ON");
  return db;
}
