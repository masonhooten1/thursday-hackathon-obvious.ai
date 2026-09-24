import type { CampaignConfig } from "./schemas";

/**
 * Export path (spec art_XasJ5Kw8, "AdsClient — mock now, live later"): the
 * real handoff workflow until a developer token exists. Validated configs
 * download as JSON (full fidelity) or as a Google Ads Editor–style CSV
 * (numbered headline/description columns, one row per ad) for manual import.
 *
 * Both functions are pure and deterministic over a stored config.
 */

export function campaignConfigToJson(config: CampaignConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

const CSV_FIXED_COLUMNS = [
  "Campaign",
  "Campaign Type",
  "Bidding Strategy",
  "Latitude",
  "Longitude",
  "Radius (km)",
  "Radius Units",
  "Ad Type",
  "Final URL",
  "Audience - Remarketing",
  "Audience - Exclusion",
] as const;
const CSV_HEADLINE_COLUMNS = 15; // Google Ads: up to 15 headlines per RSA
const CSV_DESCRIPTION_COLUMNS = 4; // Google Ads: up to 4 descriptions per RSA

/** RFC 4180 field: always quoted, embedded quotes doubled. */
function csvField(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function padTo(items: readonly string[], length: number): string[] {
  return [...items, ...Array<string>(Math.max(0, length - items.length)).fill("")];
}

/**
 * One data row per responsive search ad, with Headline 1..15 and
 * Description 1..4 columns — the layout Google Ads Editor exports use for
 * RSA assets. Empty cells pad the unused asset slots.
 */
export function campaignConfigToCsv(config: CampaignConfig): string {
  const campaign = config.campaign;
  const proximity = campaign.geoTargets[0].proximity;
  const ad = campaign.ads[0].responsiveSearchAd;
  const row = [
    campaign.name,
    campaign.advertisingChannelType,
    campaign.biddingStrategy.type,
    proximity.geoPoint.latitude,
    proximity.geoPoint.longitude,
    proximity.radius,
    proximity.radiusUnits,
    "Responsive Search Ad",
    ad.finalUrl,
    campaign.audienceCriteria.remarketingList,
    campaign.audienceCriteria.exclusionList ?? "",
    ...padTo(ad.headlines, CSV_HEADLINE_COLUMNS),
    ...padTo(ad.descriptions, CSV_DESCRIPTION_COLUMNS),
  ];
  const header = [
    ...CSV_FIXED_COLUMNS,
    ...Array.from({ length: CSV_HEADLINE_COLUMNS }, (_, i) => `Headline ${i + 1}`),
    ...Array.from({ length: CSV_DESCRIPTION_COLUMNS }, (_, i) => `Description ${i + 1}`),
  ];
  const lines = [header, row].map((cells) => cells.map(csvField).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** Attachment filename for the export route, e.g. stayradar-lake-tahoe-campaign.csv. */
export function exportFilename(market: string, format: "json" | "csv"): string {
  return `stayradar-${market}-campaign.${format}`;
}
