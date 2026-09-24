import { z } from "zod";

/**
 * Campaign wire contracts (spec art_XasJ5Kw8, "Campaign configurations —
 * Google Ads–shaped, radius-native").
 *
 * These live in the marketing module rather than `src/lib/contracts/`: they
 * are the campaign engine's internal boundary (generator → storage → export),
 * not the aggregator's shared search/leads wire format. The shape mirrors the
 * Google Ads API models the export hands off to (ProximityInfo geo targets,
 * responsive search ads), and the zod limits ARE Google's limits — an invalid
 * payload can never be stored or exported.
 *
 * Radius is stored and validated in meters (the campaigns table's unit) and
 * emitted in kilometers (the ProximityInfo wire unit). Google enforces a 1 km
 * proximity minimum; the 100 mi cap is an application sanity bound, not a
 * Google limit.
 */

export const METERS_PER_MILE = 1609.34;
/** Google Ads proximity-targeting floor: 1 km. */
export const CAMPAIGN_MIN_RADIUS_METERS = 1_000;
/** Spec default: 25 miles. */
export const CAMPAIGN_DEFAULT_RADIUS_METERS = 40_234;
/** Application cap: 100 miles — clusters larger than this stop being "local". */
export const CAMPAIGN_MAX_RADIUS_METERS = 160_934;

export const GeoPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
}).strict();
export type GeoPointConfig = z.infer<typeof GeoPointSchema>;

export const ProximityTargetSchema = z.object({
  proximity: z.object({
    geoPoint: GeoPointSchema,
    /** Kilometers, Google's proximity floor of 1 km enforced below. */
    radius: z.number().min(1).max(161),
    radiusUnits: z.literal("KILOMETERS"),
    /** Provenance of the target, e.g. "cluster:lake-tahoe (10 properties)". */
    source: z.string().min(1).max(128),
  }).strict(),
}).strict();
export type ProximityTarget = z.infer<typeof ProximityTargetSchema>;

export const ResponsiveSearchAdSchema = z.object({
  responsiveSearchAd: z.object({
    /** Google Ads limits: at most 15 headlines, 30 characters each. */
    headlines: z.array(z.string().min(1).max(30)).min(1).max(15),
    /** Google Ads limits: at most 4 descriptions, 90 characters each. */
    descriptions: z.array(z.string().min(1).max(90)).min(1).max(4),
    finalUrl: z.string().min(1).max(2048),
  }).strict(),
}).strict();
export type ResponsiveSearchAd = z.infer<typeof ResponsiveSearchAdSchema>;

export const CampaignConfigSchema = z.object({
  campaign: z.object({
    name: z.string().min(1).max(128),
    advertisingChannelType: z.literal("SEARCH"),
    biddingStrategy: z.object({ type: z.literal("MAXIMIZE_CLICKS") }).strict(),
    geoTargets: z.array(ProximityTargetSchema).min(1).max(1),
    ads: z.array(ResponsiveSearchAdSchema).min(1).max(1),
    audienceCriteria: z.object({
      /** First-party date-searcher cohort — the RLSA-style audience. */
      remarketingList: z.string().min(1).max(128),
      /** Lead submitters are excluded from paid search (email follow-up instead). */
      exclusionList: z.string().min(1).max(128).optional(),
      /** Cohort sizes at generation time — observability for the console. */
      segmentSizes: z.object({
        dateSearchers7d: z.number().int().nonnegative(),
        browsers30d: z.number().int().nonnegative(),
        leadSubmitters: z.number().int().nonnegative(),
      }).strict().optional(),
    }).strict(),
    personalization: z.object({
      originCitySignal: z.literal("utm.utm_source"),
      variants: z.array(z.string().min(1).max(64)).max(3),
    }).strict(),
    /** Records the AdsClient that accepted the payload (mock today; live is credential-gated). */
    delivery: z.object({
      client: z.string().min(1).max(32),
      resourceName: z.string().min(1).max(256),
      submittedAt: z.string().min(1),
    }).strict().optional(),
  }).strict(),
}).strict();
export type CampaignConfig = z.infer<typeof CampaignConfigSchema>;

export const GenerateCampaignInputSchema = z.object({
  market: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'expected a market slug like "lake-tahoe"'),
  radiusMeters: z
    .number()
    .int()
    .min(CAMPAIGN_MIN_RADIUS_METERS, "radius is below Google's 1 km proximity floor")
    .max(CAMPAIGN_MAX_RADIUS_METERS, "radius exceeds the 100 mi application cap")
    .default(CAMPAIGN_DEFAULT_RADIUS_METERS),
}).strict();
export type GenerateCampaignInput = z.infer<typeof GenerateCampaignInputSchema>;

/** Meters → kilometers, rounded to one decimal (ProximityInfo's unit). */
export function radiusMetersToKilometers(meters: number): number {
  return Math.round((meters / 1000) * 10) / 10;
}

/** Meters → (fractional) miles, for display and naming. */
export function radiusMetersToMiles(meters: number): number {
  return meters / METERS_PER_MILE;
}
