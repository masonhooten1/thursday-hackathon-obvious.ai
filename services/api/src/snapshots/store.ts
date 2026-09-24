import { AvailabilitySnapshotSchema, type AvailabilitySnapshot } from "@campground/shared";
import type { Db } from "../db";

/**
 * Snapshot storage — one row per campground per poll cycle (spec D4). The
 * payload is the full contract-valid snapshot; the duplicated columns exist
 * for indexing, ordering, and retention pruning.
 *
 * The foreign key cascades on campground deletion, so replacing the catalog
 * (the seeder deletes and re-inserts every row) clears snapshot history for
 * delisted campgrounds instead of leaving orphans; the poller repopulates the
 * surviving ids within one cycle. Retention: rows older than 7 days are
 * pruned after each cycle, so the store holds at most
 * `campgrounds × cycles-per-7-days` rows.
 */

/** Creates the snapshots tables. Must run after createCatalogSchema (FK target). */
export function createSnapshotsSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      facility_id INTEGER NOT NULL REFERENCES campgrounds(facility_id) ON DELETE CASCADE,
      captured_at TEXT NOT NULL,
      window_start TEXT NOT NULL,
      nights INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (facility_id, captured_at)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_captured_at ON snapshots(captured_at);
  `);
}

/**
 * Validates the snapshot against the shared contract, then writes it. The
 * real adapter already returns parsed snapshots; validating here means even a
 * misbehaving source cannot put a non-contract payload in front of the API.
 * An identical (facility, capturedAt) pair is an idempotent rewrite, not a
 * duplicate row.
 */
export function insertSnapshot(db: Db, snapshot: AvailabilitySnapshot): void {
  const valid = AvailabilitySnapshotSchema.parse(snapshot);
  db.prepare(
    `INSERT INTO snapshots (facility_id, captured_at, window_start, nights, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (facility_id, captured_at) DO UPDATE SET
       window_start = excluded.window_start,
       nights = excluded.nights,
       payload = excluded.payload`,
  ).run(
    valid.facilityId,
    valid.capturedAt,
    valid.windowStart,
    valid.nights,
    JSON.stringify(valid),
  );
}

/**
 * The most recent snapshot for a facility, by capturedAt — what
 * GET /api/availability serves. Timestamps are written as
 * `Date.toISOString()`, whose fixed-width UTC format orders lexicographically
 * the same as chronologically, so string ordering is exact.
 */
export function latestSnapshot(db: Db, facilityId: number): AvailabilitySnapshot | null {
  const row = db
    .prepare("SELECT payload FROM snapshots WHERE facility_id = ? ORDER BY captured_at DESC LIMIT 1")
    .get(facilityId) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as AvailabilitySnapshot) : null;
}

/** Deletes snapshots captured strictly before `cutoff`; returns the rows removed. */
export function pruneSnapshots(db: Db, cutoff: Date): number {
  return db.prepare("DELETE FROM snapshots WHERE captured_at < ?").run(cutoff.toISOString()).changes;
}
