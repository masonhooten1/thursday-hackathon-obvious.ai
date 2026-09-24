import type { SiteType } from "@campground/shared";

/**
 * Maps a raw Recreation.gov/RIDB site-type label (e.g. "TENT ONLY NONELECTRIC")
 * onto the shared contract's SiteType. First match wins — GROUP must be tested
 * before TENT because group-tent labels contain both. Unknown labels become
 * "other" (spec: normalization never fails a snapshot), so an unparseable or
 * missing type is data to display, not an error.
 */
export function normalizeSiteType(raw: string): SiteType {
  const value = raw.toUpperCase();
  if (value.includes("GROUP")) return "group";
  if (value.includes("CABIN")) return "cabin";
  if (/\bRV\b/.test(value) || value.includes("VEHICLE") || value.includes("TRAILER") || value.includes("CARAVAN")) {
    return "rv";
  }
  if (value.includes("TENT") || value.includes("STANDARD")) return "tent";
  return "other";
}
