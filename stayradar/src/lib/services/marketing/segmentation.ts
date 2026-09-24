import { eq, gte } from "drizzle-orm";
import type { StayRadarDb } from "@/db";
import { leads, searchEvents } from "@/db/schema";

/**
 * First-party segmentation (spec art_XasJ5Kw8, "Segments — first-party,
 * anonymous, consent-friendly").
 *
 * Cohorts are rebuilt per market from `search_events` and `leads`:
 *
 *  - dateSearchers7d — searched the market with real dates in the last
 *    7 days: highest intent, becomes the remarketing list campaigns attach.
 *  - browsers30d — viewed the market in the last 30 days without committing
 *    to dates: broad-match prospecting audience.
 *  - leadSubmitters — inquired at any point: the exclusion list. They belong
 *    in email follow-up, not paid search, so the exclusion never expires.
 *
 * Consent-friendly by construction: cohort members are anonymous, rotating
 * session hashes — never emails, device ids, or person-level location data.
 * The radius itself targets the property cluster (campaign layer), so no
 * individual's coordinates are needed here.
 *
 * `deriveSegments` is a pure function over already-fetched rows so the cohort
 * rules are unit-testable without Postgres; `buildMarketSegments` is the thin
 * DB-shaped wrapper around it.
 */

/** Origin-market signal the spec personalizes on: `utm.utm_source`. */
const ORIGIN_SIGNAL_KEYS = ["utm_source", "utm_campaign"] as const;

export const DAY_MS = 86_400_000;
export const DATE_SEARCHER_WINDOW_DAYS = 7;
export const BROWSER_WINDOW_DAYS = 30;
export const ORIGIN_VARIANT_LIMIT = 3;

export interface SegmentEventInput {
  sessionHash: string;
  /** Dominant market of the result set; null attaches to no cohort. */
  market: string | null;
  checkIn: string | null;
  checkOut: string | null;
  utm: Record<string, string> | null;
  createdAt: Date;
}

export interface SegmentLeadInput {
  /** Market of the search event the lead is linked to; null = unattributable. */
  market: string | null;
  sessionHash: string;
}

export interface MarketCohort {
  market: string;
  dateSearchers7d: string[];
  browsers30d: string[];
  leadSubmitters: string[];
  /** Top origin-market signals (lowercased), best first — campaign variants. */
  originVariants: string[];
}

function hasCommittedDates(event: SegmentEventInput): boolean {
  return event.checkIn != null && event.checkIn !== "" && event.checkOut != null && event.checkOut !== "";
}

/** First origin-market signal present on the event, lowercased. */
function originSignal(utm: Record<string, string> | null): string | null {
  for (const key of ORIGIN_SIGNAL_KEYS) {
    const value = utm?.[key]?.trim().toLowerCase();
    if (value) return value;
  }
  return null;
}

/** Top-N variants by count, ties broken alphabetically for determinism. */
function topOriginVariants(counts: Map<string, number>): string[] {
  return [...counts.entries()]
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .slice(0, ORIGIN_VARIANT_LIMIT)
    .map(([variant]) => variant);
}

/**
 * Derive per-market cohorts from raw search events and lead links.
 *
 * Windows are inclusive at the boundary (an event exactly 7 days old still
 * counts as a date-searcher). A date-searcher older than 7 days is
 * deliberately in neither cohort — the intent window has expired. Members are
 * de-duplicated per market (one session, many searches, one membership) and
 * sorted so output is deterministic.
 */
export function deriveSegments(
  events: readonly SegmentEventInput[],
  leadLinks: readonly SegmentLeadInput[],
  now: Date,
): MarketCohort[] {
  const cutoff7d = now.getTime() - DATE_SEARCHER_WINDOW_DAYS * DAY_MS;
  const cutoff30d = now.getTime() - BROWSER_WINDOW_DAYS * DAY_MS;

  type Bucket = {
    dateSearchers7d: Set<string>;
    browsers30d: Set<string>;
    originCounts: Map<string, number>;
  };
  const buckets = new Map<string, Bucket>();

  for (const event of events) {
    if (!event.market) continue;
    const bucket = buckets.get(event.market) ?? {
      dateSearchers7d: new Set<string>(),
      browsers30d: new Set<string>(),
      originCounts: new Map<string, number>(),
    };
    buckets.set(event.market, bucket);

    const at = event.createdAt.getTime();
    if (hasCommittedDates(event)) {
      if (at >= cutoff7d) bucket.dateSearchers7d.add(event.sessionHash);
      // Deliberate gap: date-searchers older than 7d are in neither cohort.
    } else if (at >= cutoff30d) {
      bucket.browsers30d.add(event.sessionHash);
    }

    if (at >= cutoff30d) {
      const origin = originSignal(event.utm);
      if (origin) bucket.originCounts.set(origin, (bucket.originCounts.get(origin) ?? 0) + 1);
    }
  }

  const leadMarkets = new Map<string, Set<string>>();
  for (const link of leadLinks) {
    if (!link.market) continue;
    const set = leadMarkets.get(link.market) ?? new Set<string>();
    set.add(link.sessionHash);
    leadMarkets.set(link.market, set);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([market, bucket]) => ({
      market,
      dateSearchers7d: [...bucket.dateSearchers7d].sort(),
      browsers30d: [...bucket.browsers30d].sort(),
      leadSubmitters: [...(leadMarkets.get(market) ?? [])].sort(),
      originVariants: topOriginVariants(bucket.originCounts),
    }));
}

/**
 * Rebuild cohorts for every market present in recent search activity.
 * Date-searchers need only the 30-day fetch (the 7d window is a subset);
 * lead exclusions are all-time by design.
 */
export async function buildMarketSegments(db: StayRadarDb, now: Date = new Date()): Promise<MarketCohort[]> {
  const cutoff30d = new Date(now.getTime() - BROWSER_WINDOW_DAYS * DAY_MS);

  const eventRows = await db
    .select({
      sessionHash: searchEvents.sessionHash,
      market: searchEvents.market,
      checkIn: searchEvents.checkIn,
      checkOut: searchEvents.checkOut,
      utm: searchEvents.utm,
      createdAt: searchEvents.createdAt,
    })
    .from(searchEvents)
    .where(gte(searchEvents.createdAt, cutoff30d));

  const leadRows = await db
    .select({ market: searchEvents.market, sessionHash: searchEvents.sessionHash })
    .from(leads)
    .innerJoin(searchEvents, eq(leads.searchEventId, searchEvents.id));

  return deriveSegments(eventRows, leadRows, now);
}
