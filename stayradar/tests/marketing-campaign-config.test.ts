import { describe, expect, it } from "vitest";
import {
  CampaignValidationError,
  buildCampaignConfig,
  type CampaignClusterInput,
} from "@/lib/services/marketing/campaign-service";
import {
  CAMPAIGN_DEFAULT_RADIUS_METERS,
  CAMPAIGN_MAX_RADIUS_METERS,
  CAMPAIGN_MIN_RADIUS_METERS,
  CampaignConfigSchema,
  GenerateCampaignInputSchema,
} from "@/lib/services/marketing/schemas";
import type { MarketCohort } from "@/lib/services/marketing/segmentation";

/**
 * Pure generator tests (no Postgres): copy fits Google's limits, the schema
 * rejects malformed payloads, and composition is deterministic.
 */

const NOW = new Date("2026-09-24T12:00:00.000Z");

const COHORT: MarketCohort = {
  market: "lake-tahoe",
  dateSearchers7d: ["hash-a", "hash-b"],
  browsers30d: ["hash-c"],
  leadSubmitters: ["hash-d"],
  originVariants: ["dallas", "sacramento", "san-francisco"],
};

const BASE: CampaignClusterInput = {
  market: "lake-tahoe",
  marketName: "Lake Tahoe",
  centroid: { latitude: 39.0968123456, longitude: -120.0324999 },
  propertyCount: 10,
  typeCounts: { cabin: 6, condo: 4 },
  minNightly: 199,
  radiusMeters: CAMPAIGN_DEFAULT_RADIUS_METERS,
  cohort: COHORT,
  generatedAt: NOW,
};

describe("buildCampaignConfig", () => {
  it("composes a Google Ads–shaped, radius-native config for the cluster", () => {
    const config = buildCampaignConfig(BASE);

    expect(config.campaign.name).toBe("stayradar_lake-tahoe_radius25mi");
    expect(config.campaign.advertisingChannelType).toBe("SEARCH");
    expect(config.campaign.biddingStrategy).toEqual({ type: "MAXIMIZE_CLICKS" });

    const proximity = config.campaign.geoTargets[0].proximity;
    expect(proximity.geoPoint).toEqual({ latitude: 39.096812, longitude: -120.0325 });
    expect(proximity.radius).toBe(40.2); // 40234 m in kilometers, one decimal
    expect(proximity.radiusUnits).toBe("KILOMETERS");
    expect(proximity.source).toBe("cluster:lake-tahoe (10 properties)");

    expect(config.campaign.ads[0].responsiveSearchAd.finalUrl).toBe("/stay/lake-tahoe");
    expect(config.campaign.audienceCriteria.remarketingList).toBe("stayradar_lake-tahoe_datesearchers_7d");
    expect(config.campaign.audienceCriteria.exclusionList).toBe("stayradar_lake-tahoe_lead_submitters");
    expect(config.campaign.audienceCriteria.segmentSizes).toEqual({
      dateSearchers7d: 2,
      browsers30d: 1,
      leadSubmitters: 1,
    });
    expect(config.campaign.personalization).toEqual({
      originCitySignal: "utm.utm_source",
      variants: ["dallas", "sacramento", "san-francisco"],
    });
  });

  it("keeps every headline within Google's 30-character limit", () => {
    const config = buildCampaignConfig(BASE);
    const headlines = config.campaign.ads[0].responsiveSearchAd.headlines;
    expect(headlines.length).toBeGreaterThanOrEqual(1);
    expect(headlines.length).toBeLessThanOrEqual(15);
    for (const headline of headlines) {
      expect(headline.length).toBeLessThanOrEqual(30);
    }
  });

  it("keeps every description within Google's 90-character limit", () => {
    const config = buildCampaignConfig(BASE);
    const descriptions = config.campaign.ads[0].responsiveSearchAd.descriptions;
    expect(descriptions.length).toBeGreaterThanOrEqual(1);
    expect(descriptions.length).toBeLessThanOrEqual(4);
    for (const description of descriptions) {
      expect(description.length).toBeLessThanOrEqual(90);
    }
  });

  it("drives ad copy from the cluster's dominant property type", () => {
    const config = buildCampaignConfig({ ...BASE, typeCounts: { condo: 7, cabin: 3 } });
    const ad = config.campaign.ads[0].responsiveSearchAd;
    expect(ad.headlines.some((headline) => headline.includes("Condos"))).toBe(true);
    expect(ad.descriptions.some((description) => description.includes("condos"))).toBe(true);
  });

  it("rounds the radius to whole miles in the campaign name", () => {
    const config = buildCampaignConfig({ ...BASE, radiusMeters: 10_000 });
    expect(config.campaign.name).toBe("stayradar_lake-tahoe_radius6mi");
  });

  it("is deterministic for identical inputs", () => {
    const a = buildCampaignConfig(BASE);
    const b = buildCampaignConfig(BASE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("handles a market with no cohort (zeroed sizes, no exclusion list)", () => {
    const config = buildCampaignConfig({ ...BASE, cohort: null });
    expect(config.campaign.audienceCriteria.segmentSizes).toEqual({
      dateSearchers7d: 0,
      browsers30d: 0,
      leadSubmitters: 0,
    });
    expect(config.campaign.audienceCriteria.exclusionList).toBeUndefined();
    expect(config.campaign.personalization.variants).toEqual([]);
  });

  it("rejects a radius below Google's 1 km proximity floor", () => {
    expect(() => buildCampaignConfig({ ...BASE, radiusMeters: 500 })).toThrow(CampaignValidationError);
    try {
      buildCampaignConfig({ ...BASE, radiusMeters: 500 });
      expect.unreachable("must have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CampaignValidationError);
      expect((error as CampaignValidationError).issues.map((i) => i.message).join(" ")).toMatch(/1 km/);
    }
  });
});

describe("GenerateCampaignInputSchema", () => {
  it("defaults the radius to the spec's 25 miles", () => {
    const parsed = GenerateCampaignInputSchema.parse({ market: "lake-tahoe" });
    expect(parsed.radiusMeters).toBe(CAMPAIGN_DEFAULT_RADIUS_METERS);
  });

  it("rejects sub-floor, over-cap, and non-slug inputs", () => {
    expect(GenerateCampaignInputSchema.safeParse({ market: "lake-tahoe", radiusMeters: CAMPAIGN_MIN_RADIUS_METERS - 1 }).success).toBe(false);
    expect(GenerateCampaignInputSchema.safeParse({ market: "lake-tahoe", radiusMeters: CAMPAIGN_MAX_RADIUS_METERS + 1 }).success).toBe(false);
    expect(GenerateCampaignInputSchema.safeParse({ market: "Lake Tahoe" }).success).toBe(false);
    expect(GenerateCampaignInputSchema.safeParse({ market: "lake-tahoe", extra: 1 }).success).toBe(false);
  });
});

describe("CampaignConfigSchema", () => {
  it("rejects a 31-character headline", () => {
    const invalid = structuredClone(buildCampaignConfig(BASE));
    invalid.campaign.ads[0].responsiveSearchAd.headlines = ["x".repeat(31)];
    expect(CampaignConfigSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects more than 15 headlines", () => {
    const invalid = structuredClone(buildCampaignConfig(BASE));
    invalid.campaign.ads[0].responsiveSearchAd.headlines = Array.from({ length: 16 }, (_, i) => `Headline ${i}`);
    expect(CampaignConfigSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects more than 4 descriptions", () => {
    const invalid = structuredClone(buildCampaignConfig(BASE));
    invalid.campaign.ads[0].responsiveSearchAd.descriptions = Array.from({ length: 5 }, (_, i) => `Description ${i}`);
    expect(CampaignConfigSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a 91-character description", () => {
    const invalid = structuredClone(buildCampaignConfig(BASE));
    invalid.campaign.ads[0].responsiveSearchAd.descriptions = ["x".repeat(91)];
    expect(CampaignConfigSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a proximity radius below Google's 1 km floor", () => {
    const invalid = structuredClone(buildCampaignConfig(BASE));
    invalid.campaign.geoTargets[0].proximity.radius = 0.5;
    expect(CampaignConfigSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts the stored shape of a valid config", () => {
    expect(CampaignConfigSchema.safeParse(buildCampaignConfig(BASE)).success).toBe(true);
  });
});
