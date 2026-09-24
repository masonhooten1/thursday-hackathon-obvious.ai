import type { AvailabilitySource } from "./adapters/types";
import { listCampgrounds } from "./catalog/schema";
import type { Db } from "./db";
import { insertSnapshot, pruneSnapshots } from "./snapshots/store";

/** Nights per availability window (spec: tonight plus the coming fortnight). */
export const WINDOW_NIGHTS = 14;
/** Snapshots are kept for 7 days, then pruned (spec). */
export const RETENTION_DAYS = 7;
/** Pause between facilities so a cycle stays a stroll, not a burst. */
export const DEFAULT_STAGGER_MS = 250;

/** Thrown when a cycle is asked to run while another is still in flight. */
export class PollCycleInProgress extends Error {
  constructor() {
    super("poll cycle already in progress");
    this.name = "PollCycleInProgress";
  }
}

export interface PollCycleReport {
  startedAt: string;
  finishedAt: string;
  /** Campgrounds the cycle attempted. */
  polled: number;
  succeeded: number;
  /** Facilities whose source failed this cycle; their previous snapshots stay live. */
  failed: number;
  failures: Array<{ facilityId: number; error: string }>;
  /** Rows removed by retention pruning. */
  pruned: number;
}

export interface PollerOptions {
  db: Db;
  /** The availability source behind the adapter interface — mocked in tests. */
  availability: AvailabilitySource;
  /** Nights per window. Default 14. */
  nights?: number;
  /** Pause between facilities. Default 250 ms; 0 disables. */
  staggerMs?: number;
  /** Snapshot retention in days. Default 7. */
  retentionDays?: number;
  /** Injectable delay (tests observe stagger without real time). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * Builds the poll-cycle task the scheduler ticks every 15 minutes (spec D4).
 * One invocation = one cycle: fetch every catalog campground's window from
 * the availability source — sequentially, staggered, one request in flight —
 * and write one snapshot row per campground per cycle.
 *
 * A failing facility never breaks the cycle: its last-known snapshot stays
 * (the row from previous cycles is untouched) and the failure is logged as a
 * degraded source and reported, per the spec's failure states. Each cycle
 * ends by pruning snapshots past retention.
 */
export function createPoller(options: PollerOptions): () => Promise<PollCycleReport> {
  const { db, availability } = options;
  const nights = options.nights ?? WINDOW_NIGHTS;
  const staggerMs = options.staggerMs ?? DEFAULT_STAGGER_MS;
  const retentionDays = options.retentionDays ?? RETENTION_DAYS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.log(message));

  let running = false;

  return async (): Promise<PollCycleReport> => {
    if (running) throw new PollCycleInProgress();
    running = true;
    try {
      const startedAt = now();
      const campgrounds = listCampgrounds(db);
      const failures: PollCycleReport["failures"] = [];
      let succeeded = 0;

      for (const [index, campground] of campgrounds.entries()) {
        if (index > 0 && staggerMs > 0) await sleep(staggerMs);
        try {
          const snapshot = await availability.fetchFacilityAvailability(
            campground.facilityId,
            startedAt,
            nights,
          );
          // A source answering for a different facility than asked is a
          // misbehaving source, not data — record it under the facility.
          if (snapshot.facilityId !== campground.facilityId) {
            throw new Error(
              `availability source answered for facility ${snapshot.facilityId}, expected ${campground.facilityId}`,
            );
          }
          insertSnapshot(db, snapshot);
          succeeded += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ facilityId: campground.facilityId, error: message });
          log(`[campground-poller] source degraded for facility ${campground.facilityId}: ${message}`);
        }
      }

      const pruned = pruneSnapshots(db, new Date(startedAt.getTime() - retentionDays * 86_400_000));
      const finishedAt = now();
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        polled: campgrounds.length,
        succeeded,
        failed: failures.length,
        failures,
        pruned,
      };
    } finally {
      running = false;
    }
  };
}
