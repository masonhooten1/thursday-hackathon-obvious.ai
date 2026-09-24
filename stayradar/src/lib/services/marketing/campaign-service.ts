import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { GeoPoint } from "@/db/geo";
import type { StayRadarDb } from "@/db";
import { campaigns, properties, type CampaignRow } from "@/db/schema";
import { MARKETS } from "@/fixtures/properties";
import { getAdsClient, type AdsClient } from "./ads-client";
import {
  CampaignConfigSchema,
  GenerateCampaignInputSchema,
  radiusMetersToKilometers,
  radiusMetersToMiles,
  type CampaignConfig,
} from "./schemas";
import { buildMarketSegments, type MarketCohort } from "./segmentation";

/**
 * Campaign generator (spec art_XasJ5Kw8, "Campaign configurations" and
 * "Personalized landing pages").
 *
 * Per market cluster the generator emits a Google Ads–shaped config: a
 * ProximityInfo geo target at the cluster's centroid (computed from the
 * properties table, not assumed), responsive-search-ad copy drawn from the
 * cluster's property mix, and the market's first-party segments attached as
 * audience criteria. The zod schema enforces Google's real limits, so no
 * invalid payload can reach the campaigns table or an export.
 *
 * Delivery runs through the AdsClient seam — the deterministic mock today;
 * a live client is a later, credential-gated swap (locked decision #6).
 * Pure composition (`buildCampaignConfig`) is separated from DB reads so the
 * copy and validation rules are unit-testable without Postgres.
 */

export class CampaignValidationError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "CampaignValidationError";
  }
}

export class MarketNotFoundError extends Error {
  constructor(market: string) {
    super(`No properties found for market "${market}" — campaigns need a seeded cluster`);
    this.name = "MarketNotFoundError";
  }
}

function zodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export interface CampaignClusterInput {
  market: string;
  marketName: string;
  centroid: GeoPoint;
  propertyCount: number;
  /** propertyType → count within the cluster. */
  typeCounts: Record<string, number>;
  minNightly: number;
  radiusMeters: number;
  cohort: MarketCohort | null;
  generatedAt: Date;
}

const TYPE_PLURALS: Record<string, string> = {
  cabin: "Cabins",
  condo: "Condos",
  house: "Houses",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const HEADLINE_FALLBACK = "Vacation Stays — Book Direct";
const DESCRIPTION_FALLBACK = "See live availability and inquire direct.";

/** Most common property type, ties broken alphabetically; unknown → "Stays". */
function dominantPluralType(typeCounts: Record<string, number>): string {
  const best = Object.entries(typeCounts).sort(
    ([typeA, countA], [typeB, countB]) => countB - countA || typeA.localeCompare(typeB),
  )[0]?.[0];
  return (best != null ? TYPE_PLURALS[best] : undefined) ?? "Stays";
}

/**
 * Pick copy that fits Google's character limits deterministically: de-duplicate,
 * keep the order, drop overlong candidates, cap at `limit`. The fallback exists
 * so a pathological market name still yields a valid ad.
 */
function fittingCopy(candidates: readonly string[], maxChars: number, limit: number, fallback: string): string[] {
  const picked = [...new Set(candidates)].filter((candidate) => candidate.length <= maxChars).slice(0, limit);
  if (picked.length === 0) picked.push(fallback);
  return picked;
}

function roundPoint(point: GeoPoint): GeoPoint {
  return {
    latitude: Math.round(point.latitude * 1e6) / 1e6,
    longitude: Math.round(point.longitude * 1e6) / 1e6,
  };
}

/**
 * Compose the campaign config for a cluster. Pure and deterministic — the same
 * cluster, cohort, and clock always produce the same config (the mock client
 * and export tests rely on that).
 */
export function buildCampaignConfig(input: CampaignClusterInput): CampaignConfig {
  const parsed = GenerateCampaignInputSchema.safeParse({
    market: input.market,
    radiusMeters: input.radiusMeters,
  });
  if (!parsed.success) {
    throw new CampaignValidationError("Invalid campaign generation input", zodIssues(parsed.error));
  }

  const typePlural = dominantPluralType(input.typeCounts);
  const typePluralLower = typePlural.toLowerCase();
  const marketName = input.marketName;
  const miles = Math.round(radiusMetersToMiles(input.radiusMeters));
  const month = MONTHS[input.generatedAt.getUTCMonth()];
  const price = Math.round(input.minNightly);

  const headlines = fittingCopy(
    [
      `Book ${marketName} ${typePlural} Direct`,
      `${marketName} ${typePlural} From $${price}`,
      `${marketName}: ${month} Dates Open`,
      `Book ${marketName}, Skip OTA Fees`,
      `${marketName} ${typePlural}, No Fees`,
    ],
    30,
    4,
    HEADLINE_FALLBACK,
  );

  const descriptions = fittingCopy(
    [
      `${input.propertyCount} verified ${marketName} ${typePluralLower} inside a ${miles}-mile radius. Real-time availability.`,
      `Skip the OTA fees — see live calendars and inquire directly in ${marketName}.`,
      `${month} dates open near ${marketName}. Compare ${typePluralLower} with real availability.`,
    ],
    90,
    4,
    DESCRIPTION_FALLBACK,
  );

  const leadCount = input.cohort?.leadSubmitters.length ?? 0;
  const config = {
    campaign: {
      name: `stayradar_${input.market}_radius${miles}mi`,
      advertisingChannelType: "SEARCH",
      biddingStrategy: { type: "MAXIMIZE_CLICKS" },
      geoTargets: [
        {
          proximity: {
            geoPoint: roundPoint(input.centroid),
            radius: radiusMetersToKilometers(input.radiusMeters),
            radiusUnits: "KILOMETERS",
            source: `cluster:${input.market} (${input.propertyCount} properties)`,
          },
        },
      ],
      ads: [
        {
          responsiveSearchAd: {
            headlines,
            descriptions,
            finalUrl: `/stay/${input.market}`,
          },
        },
      ],
      audienceCriteria: {
        remarketingList: `stayradar_${input.market}_datesearchers_7d`,
        exclusionList: leadCount > 0 ? `stayradar_${input.market}_lead_submitters` : undefined,
        segmentSizes: {
          dateSearchers7d: input.cohort?.dateSearchers7d.length ?? 0,
          browsers30d: input.cohort?.browsers30d.length ?? 0,
          leadSubmitters: leadCount,
        },
      },
      personalization: {
        originCitySignal: "utm.utm_source",
        variants: input.cohort?.originVariants ?? [],
      },
    },
  };

  // Composition is trusted only after the schema says so — a composition bug
  // must throw here, never surface as a stored or exported payload.
  return CampaignConfigSchema.parse(config);
}

interface MarketCluster {
  market: string;
  marketName: string;
  centroid: GeoPoint;
  propertyCount: number;
  typeCounts: Record<string, number>;
  minNightly: number;
}

function marketDisplayName(market: string): string {
  const known = MARKETS.find((m) => m.id === market);
  if (known) return known.name;
  return market
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function loadMarketCluster(db: StayRadarDb, market: string): Promise<MarketCluster> {
  const summary = await db.execute<{
    latitude: number | null;
    longitude: number | null;
    property_count: number;
    min_nightly: number | null;
  }>(sql`
    SELECT
      ST_Y(ST_Centroid(ST_Collect(location::geometry)))::float8 AS latitude,
      ST_X(ST_Centroid(ST_Collect(location::geometry)))::float8 AS longitude,
      COUNT(*)::int AS property_count,
      MIN(base_nightly)::float8 AS min_nightly
    FROM properties
    WHERE market = ${market}
  `);
  const row = summary.rows[0];
  if (!row || Number(row.property_count) === 0) {
    throw new MarketNotFoundError(market);
  }
  if (row.latitude == null || row.longitude == null || row.min_nightly == null) {
    throw new Error(`market "${market}" returned an unusable cluster centroid — check property rows`);
  }

  const typeRows = await db
    .select({ propertyType: properties.propertyType, count: sql<number>`count(*)::int` })
    .from(properties)
    .where(eq(properties.market, market))
    .groupBy(properties.propertyType);

  return {
    market,
    marketName: marketDisplayName(market),
    centroid: { latitude: row.latitude, longitude: row.longitude },
    propertyCount: Number(row.property_count),
    typeCounts: Object.fromEntries(typeRows.map((r) => [r.propertyType, Number(r.count)])),
    minNightly: Number(row.min_nightly),
  };
}

export interface GenerateCampaignOptions {
  /** Overrides the default AdsClient (tests inject the mock explicitly). */
  adsClient?: AdsClient;
  /** Overrides the wall clock for deterministic timestamps. */
  now?: Date;
}

/**
 * Generate, submit through the AdsClient seam, and persist a market campaign.
 * Throws CampaignValidationError (400-shaped) for invalid input and
 * MarketNotFoundError (404-shaped) for unknown/empty markets.
 */
export async function generateCampaign(
  db: StayRadarDb,
  rawInput: unknown,
  options: GenerateCampaignOptions = {},
): Promise<CampaignRow> {
  const now = options.now ?? new Date();
  const parsed = GenerateCampaignInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new CampaignValidationError("Invalid campaign generation input", zodIssues(parsed.error));
  }
  const input = parsed.data;

  const cluster = await loadMarketCluster(db, input.market);
  const cohorts = await buildMarketSegments(db, now);
  const cohort = cohorts.find((c) => c.market === input.market) ?? null;
  const config = buildCampaignConfig({ ...cluster, radiusMeters: input.radiusMeters, cohort, generatedAt: now });

  const client = options.adsClient ?? getAdsClient();
  const { resourceName } = await client.createCampaign(config);
  const delivered: CampaignConfig = {
    ...config,
    campaign: {
      ...config.campaign,
      delivery: { client: client.clientName, resourceName, submittedAt: now.toISOString() },
    },
  };

  const [row] = await db
    .insert(campaigns)
    .values({
      market: input.market,
      radiusMeters: input.radiusMeters,
      config: delivered,
      status: "generated",
      generatedAt: now,
    })
    .returning();
  return row;
}

export async function listCampaigns(db: StayRadarDb, market?: string): Promise<CampaignRow[]> {
  // Drizzle 0.45 rejects `.where(undefined)` at execution — branch instead.
  const filtered = market
    ? db.select().from(campaigns).where(eq(campaigns.market, market))
    : db.select().from(campaigns);
  return filtered.orderBy(desc(campaigns.generatedAt));
}

export async function getCampaign(db: StayRadarDb, id: string): Promise<CampaignRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return row ?? null;
}

/** Flip a campaign to "exported" once its config has been handed off. Idempotent. */
export async function markExported(db: StayRadarDb, id: string): Promise<CampaignRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.update(campaigns).set({ status: "exported" }).where(eq(campaigns.id, id)).returning();
  return row ?? null;
}
