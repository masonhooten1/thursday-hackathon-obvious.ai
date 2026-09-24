export type FreshnessTier = "fresh" | "aging" | "stale" | "never";

// UI freshness tiers from the MVP spec: fresh within one poll interval, aging
// through four (15–60 min at the 15-minute cadence), stale beyond. A null or
// unparseable timestamp is "never" — the marker stays hidden until first data.
export function getFreshnessTier(
  capturedAt: string | null,
  now: Date,
  intervalMinutes: number = 15,
): FreshnessTier {
  if (!capturedAt) return "never";
  const captured = Date.parse(capturedAt);
  if (Number.isNaN(captured)) return "never";
  const ageMinutes = (now.getTime() - captured) / 60_000;
  if (ageMinutes <= intervalMinutes) return "fresh";
  if (ageMinutes <= intervalMinutes * 4) return "aging";
  return "stale";
}
