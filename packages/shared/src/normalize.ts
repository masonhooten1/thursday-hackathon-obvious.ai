import { SITE_TYPES, type SiteType } from "./contract";

/**
 * Normalization rules from the MVP spec's data rules: recreation.gov
 * campsite types map onto the contract's SiteType union, and anything
 * unrecognized becomes "other". Rules are prefix-based first-match, ordered
 * so specific families win over generic ones.
 */
const SITE_TYPE_RULES: ReadonlyArray<readonly [prefix: string, siteType: SiteType]> = [
  ["GROUP", "group"],
  ["RV", "rv"],
  ["CABIN", "cabin"],
  ["EQUESTRIAN", "other"],
  ["STANDARD", "tent"],
  ["TENT", "tent"],
  ["WALK TO", "tent"],
  ["HIKE TO", "tent"],
];

/**
 * Maps one raw campsite type (e.g. "STANDARD NONELECTRIC", "RV ELECTRIC") to a
 * contract SiteType. Returns null for types that are not bookable inventory —
 * MANAGEMENT sites are administrative holds, not customer-reservable sites.
 */
export function normalizeSiteType(rawType: string): SiteType | null {
  const value = rawType.trim().toUpperCase();
  if (!value) return null;
  if (value === "MANAGEMENT") return null;
  for (const [prefix, siteType] of SITE_TYPE_RULES) {
    if (value.startsWith(prefix)) return siteType;
  }
  return "other";
}

/**
 * Collapses raw campsite types into the deduped SiteType list for a
 * campground, in contract order so wire output is stable.
 */
export function normalizeSiteTypes(rawTypes: Iterable<string>): SiteType[] {
  const present = new Set<SiteType>();
  for (const raw of rawTypes) {
    const siteType = normalizeSiteType(raw);
    if (siteType) present.add(siteType);
  }
  return SITE_TYPES.filter((siteType) => present.has(siteType));
}
