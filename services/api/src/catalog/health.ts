/**
 * Seed-time facility health checks. The seeder verifies every catalog facility
 * id against the live reservation site and flags dead ids instead of failing —
 * a stale catalog row is data, not a seed error.
 *
 * Semantics verified against the live site (2026-09-24): a real campground
 * page returns 200, a never-existed id returns 404, and HEAD is answered 405 —
 * so checks must use GET.
 */
import type { Campground } from "@campground/shared";

/** Identifying User-Agent per the MVP spec's politeness rules. */
export const USER_AGENT = "CampgroundTonight-MVP/0.1 (hackathon prototype)";

export type BookingPageStatus = "alive" | "dead" | "unverified";

/**
 * 200 → alive, 404 → dead, anything else (403 block, 429 throttle, 5xx,
 * network error) → unverified. Only a 404 proves the id is dead; every other
 * non-200 might be a transient block, and marking those "dead" would drop
 * live campgrounds from the catalog.
 */
export function classifyPageStatus(httpStatus: number | null): BookingPageStatus {
  if (httpStatus === 200) return "alive";
  if (httpStatus === 404) return "dead";
  return "unverified";
}

export interface HealthCheckResult {
  facilityId: number;
  bookingUrl: string;
  status: BookingPageStatus;
  /** HTTP status when the page answered, null on network error. */
  httpStatus: number | null;
}

export interface HealthCheckReport {
  checked: number;
  alive: number;
  /** Facility ids whose booking page 404'd — flagged in seed output. */
  dead: number[];
  /** Facility ids that could not be verified (blocked, throttled, offline). */
  unverified: number[];
}

export interface PageChecker {
  /** Returns the HTTP status for a GET of the page, or null on network error. */
  (bookingUrl: string): Promise<number | null>;
}

export interface HealthCheckDeps {
  checkPage: PageChecker;
  /** Pause between requests so a seed-time sweep stays polite. */
  delayMs: number;
  sleep: (ms: number) => Promise<void>;
}

/** Live page checker — the default dependency, overridable in tests. */
export const livePageChecker: PageChecker = async (bookingUrl) => {
  try {
    const response = await fetch(bookingUrl, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    return response.status;
  } catch {
    return null;
  }
};

const defaultDeps: HealthCheckDeps = {
  checkPage: livePageChecker,
  // slow enough that live verification of all 60 ids completes without
  // provoking transient blocks (observed 2026-09-24: 1.2s spacing drew
  // intermittent non-404 refusals; 2.5s clears them)
  delayMs: 2_500,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export async function healthCheckCampgrounds(
  campgrounds: Campground[],
  deps: Partial<HealthCheckDeps> = {},
): Promise<HealthCheckReport> {
  const { checkPage, delayMs, sleep } = { ...defaultDeps, ...deps };
  const results: HealthCheckResult[] = [];
  for (const [index, campground] of campgrounds.entries()) {
    if (index > 0 && delayMs > 0) {
      await sleep(delayMs);
    }
    const httpStatus = await checkPage(campground.bookingUrl);
    results.push({
      facilityId: campground.facilityId,
      bookingUrl: campground.bookingUrl,
      status: classifyPageStatus(httpStatus),
      httpStatus,
    });
  }

  return {
    checked: results.length,
    alive: results.filter((r) => r.status === "alive").length,
    dead: results.filter((r) => r.status === "dead").map((r) => r.facilityId),
    unverified: results.filter((r) => r.status === "unverified").map((r) => r.facilityId),
  };
}
