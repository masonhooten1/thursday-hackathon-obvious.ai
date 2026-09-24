import { getFreshnessTier, type FreshnessTier } from "./freshness";

/**
 * The freshness line under the header and in the detail sheet (spec table):
 *   fresh  → "updated 4 min ago"
 *   aging  → same wording, rendered muted by the caller
 *   stale  → "data may be old" (the caller shows the badge treatment)
 *   never  → "checking…" — no snapshot has landed yet
 */
export function formatFreshnessLine(capturedAt: string | null, now: Date, intervalMinutes: number = 15): string {
  const tier = getFreshnessTier(capturedAt, now, intervalMinutes);
  if (tier === "never") return "checking…";
  if (tier === "stale") return "data may be old";
  const captured = Date.parse(capturedAt ?? "");
  const ageMinutes = Math.floor((now.getTime() - captured) / 60_000);
  if (ageMinutes < 1) return "updated just now";
  return `updated ${ageMinutes} min ago`;
}

/** Whether the freshness line gets the muted (aging) treatment rather than normal. */
export function isMutedFreshness(tier: FreshnessTier): boolean {
  return tier === "aging";
}
