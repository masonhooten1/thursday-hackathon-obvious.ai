import { POLL_INTERVAL_MINUTES, STALE_AFTER_MULTIPLE } from "@campground/shared";

/**
 * Freshness rules for serving snapshots (spec D4). The threshold is derived
 * from the shared contract's constants — never hardcoded — so the API and the
 * app agree on what "stale" means: twice the poll interval (30 minutes at the
 * v1 cadence of 15).
 */
export const STALE_AFTER_MS = POLL_INTERVAL_MINUTES * STALE_AFTER_MULTIPLE * 60_000;

/**
 * A snapshot is stale once its age reaches twice the poll interval: at the
 * 30-minute mark the data has missed a full poll cycle beyond the normal
 * cadence, so it can no longer be treated as current.
 */
export function isSnapshotStale(capturedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(capturedAt) >= STALE_AFTER_MS;
}

/**
 * The response-level flag drives the app's "availability data is delayed"
 * banner: it fires when the freshest snapshot in the response is itself
 * stale — i.e. every campground is past the threshold. With no snapshots at
 * all (the poller has never run) nothing is stale; the app shows its
 * "checking…" placeholder instead of an error banner.
 */
export function responseIsStale(capturedAts: Array<string | null>, now: Date): boolean {
  const captured = capturedAts.filter((ts): ts is string => ts !== null);
  if (captured.length === 0) return false;
  const freshest = Math.max(...captured.map((ts) => Date.parse(ts)));
  return now.getTime() - freshest >= STALE_AFTER_MS;
}
