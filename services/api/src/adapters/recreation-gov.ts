import {
  AvailabilitySnapshotSchema,
  SITE_TYPES,
  type AvailabilitySnapshot,
  type SiteType,
} from "@campground/shared";
import type { PoliteClient } from "./politeness";
import { normalizeSiteType } from "./site-type";
import type { AvailabilitySource } from "./types";

/**
 * AvailabilitySource over the undocumented Recreation.gov month endpoint,
 * discovered live and documented in docs/recreation-gov-endpoints.md:
 *
 *   GET /api/camps/availability/campground/{facilityId}/month?start_date=YYYY-MM-01T00:00:00.000Z
 *
 * The endpoint is month-aligned, so a window that crosses a month boundary
 * fetches both months and merges per night. Only the literal availability
 * state "Available" counts; every other state (Reserved, Not Available
 * Cutoff, Closed, or anything new the service introduces) counts as
 * unavailable. Unknown/missing campsite types normalize to "other" —
 * normalization never fails a snapshot.
 */

const BASE_URL = "https://www.recreation.gov";
const NIGHT_MS = 24 * 60 * 60 * 1000;

/** The parsed slice of a campsite record the snapshot needs. */
interface ParsedCampsite {
  type: SiteType;
  /** UTC calendar dates (YYYY-MM-DD) whose availability state is "Available". */
  availableDates: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * UTC calendar dates for the window: `windowStart` (YYYY-MM-DD, first night)
 * through the night `nights - 1` days later.
 */
export function windowDates(windowStart: string, nights: number): string[] {
  const [year, month, day] = windowStart.split("-").map(Number);
  // Individual checks (not .some) so TypeScript narrows the destructured parts.
  if (year === undefined || month === undefined || day === undefined ||
      [year, month, day].some(Number.isNaN)) {
    throw new Error(`invalid windowStart: ${windowStart}`);
  }
  const firstNight = Date.UTC(year, month - 1, day);
  return Array.from({ length: nights }, (_, index) =>
    new Date(firstNight + index * NIGHT_MS).toISOString().slice(0, 10),
  );
}

/** Distinct month first-days (YYYY-MM-01) covered by the given dates, in order. */
export function monthStarts(dates: string[]): string[] {
  const months = dates.map((date) => `${date.slice(0, 8)}01`);
  return [...new Set(months)].sort();
}

/**
 * Parses one month response into per-site availability. Tolerant on input —
 * unknown shapes degrade to "no available nights" instead of throwing, so a
 * service-side field rename can only widen the unavailable set, never crash
 * the poller.
 */
export function parseMonthResponse(raw: unknown): Map<number, ParsedCampsite> {
  const parsed = new Map<number, ParsedCampsite>();
  if (!isRecord(raw) || !isRecord(raw.campsites)) {
    throw new Error("unexpected availability response shape: missing campsites object");
  }
  for (const [key, value] of Object.entries(raw.campsites)) {
    const campsiteId = Number(key);
    if (!Number.isInteger(campsiteId) || campsiteId <= 0 || !isRecord(value)) continue;
    const type = normalizeSiteType(typeof value.campsite_type === "string" ? value.campsite_type : "");
    const availableDates = new Set<string>();
    if (isRecord(value.availabilities)) {
      for (const [dateKey, state] of Object.entries(value.availabilities)) {
        if (state === "Available" && /^\d{4}-\d{2}-\d{2}T/.test(dateKey)) {
          availableDates.add(dateKey.slice(0, 10));
        }
      }
    }
    parsed.set(campsiteId, { type, availableDates });
  }
  return parsed;
}

function buildSnapshot(input: {
  facilityId: number;
  sites: Iterable<ParsedCampsite>;
  windowStart: string;
  nights: number;
  capturedAt: Date;
}): AvailabilitySnapshot {
  const { facilityId, sites, windowStart, nights, capturedAt } = input;
  const dates = windowDates(windowStart, nights);
  const byType = Object.fromEntries(
    SITE_TYPES.map((type) => [type, Array.from({ length: nights }, () => 0)]),
  ) as Record<SiteType, number[]>;
  let totalSites = 0;
  for (const site of sites) {
    totalSites += 1;
    const counts = byType[site.type];
    dates.forEach((date, index) => {
      if (site.availableDates.has(date)) counts[index] = (counts[index] ?? 0) + 1;
    });
  }
  return {
    facilityId,
    capturedAt: capturedAt.toISOString(),
    windowStart,
    nights,
    byType,
    totalSites,
  };
}

export class RecreationGovAvailability implements AvailabilitySource {
  readonly name = "recreation-gov";
  private readonly client: PoliteClient;
  private readonly baseUrl: string;

  constructor(client: PoliteClient, baseUrl: string = BASE_URL) {
    this.client = client;
    this.baseUrl = baseUrl;
  }

  async fetchFacilityAvailability(
    facilityId: number,
    start: Date,
    nights: number,
  ): Promise<AvailabilitySnapshot> {
    const windowStart = start.toISOString().slice(0, 10);
    const months = monthStarts(windowDates(windowStart, nights));
    const sites = new Map<number, ParsedCampsite>();
    for (const month of months) {
      const raw = await this.client.getJson(this.monthUrl(facilityId, month));
      for (const [campsiteId, parsed] of parseMonthResponse(raw)) {
        const existing = sites.get(campsiteId);
        if (existing) {
          for (const date of parsed.availableDates) existing.availableDates.add(date);
        } else {
          sites.set(campsiteId, parsed);
        }
      }
    }
    return AvailabilitySnapshotSchema.parse(
      buildSnapshot({ facilityId, sites: sites.values(), windowStart, nights, capturedAt: new Date() }),
    );
  }

  /** The exact request shape the reservation page itself makes (see discovery doc). */
  private monthUrl(facilityId: number, monthStart: string): string {
    return `${this.baseUrl}/api/camps/availability/campground/${facilityId}/month?start_date=${encodeURIComponent(
      `${monthStart}T00:00:00.000Z`,
    )}`;
  }
}
