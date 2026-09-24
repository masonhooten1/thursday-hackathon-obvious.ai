import { SITE_TYPES, type AvailabilityResponse, type AvailabilitySnapshot, type Campground, type Park, type SiteType } from "@campground/shared";
import { dayDiff } from "./dates";
import { getFreshnessTier, type FreshnessTier } from "./freshness";

/** What a marker's color encodes (spec): green now, amber within a week, gray nothing. */
export type MarkerAvailability = "available" | "soon" | "none";

/** The chips offered in the UI (spec). "other" sites surface only in sheet breakdowns. */
export const CHIP_TYPES: readonly SiteType[] = ["tent", "rv", "cabin", "group"] as const;

/** How far ahead the amber state looks, in nights from the selected night. */
export const SOON_WINDOW_NIGHTS = 7;

export interface CampgroundView {
  campground: Campground;
  park: Park | null;
  snapshot: AvailabilitySnapshot | null;
  freshness: FreshnessTier;
  /** Free counts on the selected night, per type (all types, not just selected). */
  countsByType: Record<SiteType, number>;
  /** Free across the selected types on the selected night. */
  freeOnSelectedNight: number;
  /** Free across the selected types within SOON_WINDOW_NIGHTS of it. */
  freeWithinSoonWindow: number;
  availability: MarkerAvailability;
}

export interface AvailabilityView {
  date: string;
  campgrounds: CampgroundView[];
  parks: Park[];
  /** True when at least one marker is green for the current filters. */
  anyAvailable: boolean;
  /** capturedAt of the most recent snapshot, for the header freshness line. */
  latestCapturedAt: string | null;
}

/**
 * The single derivation the UI renders: join campgrounds with parks, compute
 * per-night counts for the selected types, freshness, and marker state.
 * Pure — `now` is injected; the selected types gate every count.
 */
export function buildAvailabilityView(
  payload: { parks: Park[]; availability: AvailabilityResponse },
  selectedTypes: readonly SiteType[],
  dateISO: string,
  now: Date,
  intervalMinutes: number = 15,
): AvailabilityView {
  const parksById = new Map(payload.parks.map((park) => [park.id, park]));

  const campgrounds = payload.availability.campgrounds.map((entry) => {
    const snapshot = entry.snapshot;
    const freshness = getFreshnessTier(snapshot?.capturedAt ?? null, now, intervalMinutes);
    const countsByType = countByType(snapshot, dateISO);
    const freeOnSelectedNight = sumTypes(countsByType, selectedTypes);
    const freeWithinSoonWindow = countFreeWithinSoonWindow(snapshot, selectedTypes, dateISO);
    const availability = deriveAvailability(freeOnSelectedNight, freeWithinSoonWindow, freshness);
    return {
      campground: entry,
      park: parksById.get(entry.parkId) ?? null,
      snapshot,
      freshness,
      countsByType,
      freeOnSelectedNight,
      freeWithinSoonWindow,
      availability,
    };
  });

  return {
    date: dateISO,
    campgrounds,
    parks: payload.parks,
    anyAvailable: campgrounds.some((view) => view.availability === "available"),
    latestCapturedAt: latestCapturedAt(payload.availability),
  };
}

/** Markers the map should render: "never" snapshots stay hidden until first data (spec). */
export function isMarkerVisible(view: CampgroundView): boolean {
  return view.freshness !== "never";
}

/** Index of dateISO within the snapshot window, or null when out of range. */
export function nightIndex(snapshot: AvailabilitySnapshot, dateISO: string): number | null {
  const diff = dayDiff(dateISO, snapshot.windowStart);
  if (diff < 0 || diff >= snapshot.nights) return null;
  return diff;
}

/** Free counts per site type on one night. Out-of-window dates count as zero. */
export function countByType(snapshot: AvailabilitySnapshot | null, dateISO: string): Record<SiteType, number> {
  const counts = zeroCounts();
  if (!snapshot) return counts;
  const idx = nightIndex(snapshot, dateISO);
  if (idx === null) return counts;
  for (const type of SITE_TYPES) {
    counts[type] = snapshot.byType[type][idx] ?? 0;
  }
  return counts;
}

/** Total free for the selected types on the selected night. */
export function countFreeOnNight(
  snapshot: AvailabilitySnapshot | null,
  selectedTypes: readonly SiteType[],
  dateISO: string,
): number {
  const counts = countByType(snapshot, dateISO);
  return sumTypes(counts, selectedTypes);
}

/**
 * Total free for the selected types across the SOON window: the selected
 * night plus the following SOON_WINDOW_NIGHTS − 1 (amber's lookup range).
 */
export function countFreeWithinSoonWindow(
  snapshot: AvailabilitySnapshot | null,
  selectedTypes: readonly SiteType[],
  dateISO: string,
): number {
  if (!snapshot) return 0;
  const startIdx = nightIndex(snapshot, dateISO);
  if (startIdx === null) return 0;
  let total = 0;
  for (let i = startIdx; i < Math.min(startIdx + SOON_WINDOW_NIGHTS, snapshot.nights); i++) {
    for (const type of selectedTypes) {
      total += snapshot.byType[type][i] ?? 0;
    }
  }
  return total;
}

function deriveAvailability(freeOnSelectedNight: number, freeWithinSoonWindow: number, freshness: FreshnessTier): MarkerAvailability {
  if (freshness === "never") return "none";
  if (freeOnSelectedNight > 0) return "available";
  if (freeWithinSoonWindow > 0) return "soon";
  return "none";
}

function sumTypes(counts: Record<SiteType, number>, types: readonly SiteType[]): number {
  return types.reduce((sum, type) => sum + counts[type], 0);
}

function zeroCounts(): Record<SiteType, number> {
  return { tent: 0, rv: 0, cabin: 0, group: 0, other: 0 };
}

function latestCapturedAt(response: AvailabilityResponse): string | null {
  const stamps = response.campgrounds
    .map((entry) => entry.snapshot?.capturedAt)
    .filter((s): s is string => typeof s === "string")
    .sort();
  return stamps.at(-1) ?? null;
}
