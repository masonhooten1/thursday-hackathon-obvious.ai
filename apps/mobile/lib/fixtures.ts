import { AvailabilityResponseSchema, SITE_TYPES, type AvailabilityResponse, type AvailabilitySnapshot, type Park, type SiteType } from "@campground/shared";
import { toISODate } from "./dates";

/**
 * Fixture catalog standing in for the API while the data-layer tasks (T2–T4)
 * run in parallel. Every shape is parsed against the shared contract in
 * tests; campground ids mirror the spec example where one exists (232490 =
 * Mather) and are otherwise plausible placeholders — NOT verified live ids.
 *
 * Snapshot ages are generated relative to `now` so the demo always shows all
 * four freshness tiers and all three marker colors.
 */

export const FIXTURE_PARKS: Park[] = [
  { id: "yosemite", name: "Yosemite National Park", state: "CA", lat: 37.8651, lng: -119.5383 },
  { id: "grand-canyon", name: "Grand Canyon National Park", state: "AZ", lat: 36.1069, lng: -112.1129 },
  { id: "yellowstone", name: "Yellowstone National Park", state: "WY", lat: 44.428, lng: -110.5885 },
  { id: "zion", name: "Zion National Park", state: "UT", lat: 37.2982, lng: -113.0263 },
  { id: "smoky-mountains", name: "Great Smoky Mountains National Park", state: "TN", lat: 35.6112, lng: -83.4895 },
  { id: "joshua-tree", name: "Joshua Tree National Park", state: "CA", lat: 33.8734, lng: -115.901 },
];

/** Snapshot age in minutes for each demo freshness tier. */
const AGE_MINUTES = { fresh: 4, aging: 30, stale: 120 } as const;

type NightPattern = number | readonly number[];

interface FixtureEntry {
  facilityId: number;
  parkId: Park["id"];
  name: string;
  lat: number;
  lng: number;
  siteTypes: SiteType[];
  /** Available sites per type; a number repeats across all 14 nights. */
  available?: Partial<Record<SiteType, NightPattern>>;
  /** Snapshot age tier — omit for the "never" (no snapshot) case. */
  age?: keyof typeof AGE_MINUTES;
}

// Written so the demo shows every marker state: green, amber (none tonight
// but some within 7 nights), gray, dashed-ring stale, and a hidden "never".
const FIXTURES: FixtureEntry[] = [
  { facilityId: 232453, parkId: "yosemite", name: "Upper Pines", lat: 37.7385, lng: -119.5628, siteTypes: ["tent", "rv"], available: { tent: 3, rv: 0 }, age: "fresh" },
  { facilityId: 232454, parkId: "yosemite", name: "Lower Pines", lat: 37.7402, lng: -119.559, siteTypes: ["tent", "rv"], available: { tent: [0, 0, 2, 4, 6, 8, 6, 4, 3, 2, 0, 0, 1, 2], rv: 1 }, age: "aging" },
  { facilityId: 232455, parkId: "yosemite", name: "North Pines", lat: 37.7425, lng: -119.5729, siteTypes: ["tent", "rv", "group"], available: { tent: 5, group: 1 }, age: "stale" },
  { facilityId: 232456, parkId: "yosemite", name: "Tuolumne Meadows", lat: 37.873, lng: -119.386, siteTypes: ["tent", "group"], available: { tent: [0, 0, 0, 3, 6, 9, 9, 6, 3, 0, 0, 0, 2, 4] }, age: "fresh" },
  { facilityId: 232490, parkId: "grand-canyon", name: "Mather Campground", lat: 36.0616, lng: -112.1082, siteTypes: ["tent", "rv", "group"], available: { tent: 8, rv: 4, group: 1 }, age: "fresh" },
  { facilityId: 232491, parkId: "grand-canyon", name: "Trailer Village", lat: 36.0589, lng: -112.1053, siteTypes: ["rv"], available: { rv: 0 }, age: "fresh" },
  { facilityId: 232492, parkId: "grand-canyon", name: "Desert View", lat: 36.0602, lng: -111.8359, siteTypes: ["tent"], available: { tent: [0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 1, 1, 0] }, age: "stale" },
  { facilityId: 232511, parkId: "yellowstone", name: "Madison", lat: 44.6237, lng: -110.8681, siteTypes: ["tent", "rv"], available: { tent: 6, rv: 2 }, age: "fresh" },
  { facilityId: 232512, parkId: "yellowstone", name: "Fishing Bridge RV Park", lat: 44.5589, lng: -110.7626, siteTypes: ["rv"], available: { rv: 0 }, age: "fresh" },
  { facilityId: 232513, parkId: "yellowstone", name: "Grant Village", lat: 44.386, lng: -110.564, siteTypes: ["tent", "rv", "cabin"], available: { tent: 4, cabin: 2 }, age: "fresh" },
  { facilityId: 232463, parkId: "zion", name: "Watchman Campground", lat: 37.2001, lng: -112.987, siteTypes: ["tent", "rv", "group"], available: { tent: [0, 0, 0, 5, 5, 0, 0, 0, 0, 3, 3, 0, 0, 0] }, age: "aging" },
  { facilityId: 232464, parkId: "zion", name: "South Campground", lat: 37.1889, lng: -112.9731, siteTypes: ["tent"], available: { tent: 0 }, age: "stale" },
  { facilityId: 232560, parkId: "smoky-mountains", name: "Elkmont", lat: 35.6468, lng: -83.639, siteTypes: ["tent", "group"], available: { tent: 7, group: 2 }, age: "fresh" },
  { facilityId: 232561, parkId: "smoky-mountains", name: "Cades Cove", lat: 35.6049, lng: -83.7619, siteTypes: ["tent", "rv"], available: { tent: [0, 0, 0, 0, 4, 4, 4, 0, 0, 0, 0, 2, 2, 2] }, age: "fresh" },
  { facilityId: 232562, parkId: "smoky-mountains", name: "Cosby Knob", lat: 35.7554, lng: -83.5609, siteTypes: ["tent"] },
  { facilityId: 232610, parkId: "joshua-tree", name: "Jumbo Rocks", lat: 33.9936, lng: -116.0608, siteTypes: ["tent"], available: { tent: 2 }, age: "fresh" },
  { facilityId: 232611, parkId: "joshua-tree", name: "Black Rock", lat: 34.0789, lng: -116.3878, siteTypes: ["tent", "rv"], available: { tent: 0, rv: 0 }, age: "fresh" },
  { facilityId: 232612, parkId: "joshua-tree", name: "Indian Cove", lat: 34.072, lng: -116.178, siteTypes: ["tent", "group"], available: { tent: 1, group: 1 }, age: "aging" },
];

function windowStartISO(now: Date): string {
  return toISODate(now);
}

function capturedAtISO(ageMinutes: number, now: Date): string {
  return new Date(now.getTime() - ageMinutes * 60_000).toISOString();
}

function buildSnapshot(entry: FixtureEntry, now: Date, nights: number): AvailabilitySnapshot | null {
  if (!entry.age) return null;
  const patterns = new Map<SiteType, NightPattern>(
    SITE_TYPES.map((type) => [type, entry.available?.[type] ?? 0]),
  );
  const byType = {} as Record<SiteType, number[]>;
  for (const type of SITE_TYPES) {
    const pattern = patterns.get(type) ?? 0;
    byType[type] = Array.from({ length: nights }, (_, i) =>
      typeof pattern === "number" ? pattern : (pattern[i] ?? 0),
    );
  }
  const totalSites = SITE_TYPES.reduce((sum, type) => sum + Math.max(...byType[type]), 0) || 40;
  return {
    facilityId: entry.facilityId,
    capturedAt: capturedAtISO(AGE_MINUTES[entry.age], now),
    windowStart: windowStartISO(now),
    nights,
    byType,
    totalSites,
  };
}

function bookingUrl(facilityId: number): string {
  return `https://www.recreation.gov/camping/campgrounds/${facilityId}`;
}

/** Builds the full fixture availability response for a moment in time. */
export function buildFixtureAvailability(now: Date, nights = 14): AvailabilityResponse {
  const response = {
    date: toISODate(now),
    fetchedAt: now.toISOString(),
    stale: false,
    campgrounds: FIXTURES.map((entry) => ({
      facilityId: entry.facilityId,
      parkId: entry.parkId,
      name: entry.name,
      lat: entry.lat,
      lng: entry.lng,
      bookingUrl: bookingUrl(entry.facilityId),
      siteTypes: entry.siteTypes,
      snapshot: buildSnapshot(entry, now, nights),
    })),
  };
  // Fail loudly in dev/tests if the fixtures ever drift from the contract.
  return AvailabilityResponseSchema.parse(response);
}
