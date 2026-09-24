import { describe, expect, it } from "vitest";
import { buildCampaignConfig, type CampaignClusterInput } from "@/lib/services/marketing/campaign-service";
import { campaignConfigToCsv, campaignConfigToJson, exportFilename } from "@/lib/services/marketing/export";
import { CAMPAIGN_DEFAULT_RADIUS_METERS } from "@/lib/services/marketing/schemas";

/**
 * Pure export tests (no Postgres): JSON round-trips the stored config; CSV is
 * a deterministic, RFC 4180-escaped, Editor-style sheet.
 */

const BASE: CampaignClusterInput = {
  market: "lake-tahoe",
  marketName: "Lake Tahoe",
  centroid: { latitude: 39.0968, longitude: -120.0324 },
  propertyCount: 10,
  typeCounts: { cabin: 6, condo: 4 },
  minNightly: 199,
  radiusMeters: CAMPAIGN_DEFAULT_RADIUS_METERS,
  cohort: {
    market: "lake-tahoe",
    dateSearchers7d: ["hash-a"],
    browsers30d: [],
    leadSubmitters: ["hash-d"],
    originVariants: ["dallas"],
  },
  generatedAt: new Date("2026-09-24T12:00:00.000Z"),
};

/** Minimal RFC 4180 row reader for assertions (quoted fields, doubled quotes). */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

describe("campaignConfigToJson", () => {
  it("round-trips back to exactly the stored config", () => {
    const config = buildCampaignConfig(BASE);
    expect(JSON.parse(campaignConfigToJson(config))).toEqual(config);
  });

  it("is deterministic and newline-terminated", () => {
    const config = buildCampaignConfig(BASE);
    expect(campaignConfigToJson(config)).toBe(campaignConfigToJson(config));
    expect(campaignConfigToJson(config).endsWith("}\n")).toBe(true);
  });
});

describe("campaignConfigToCsv", () => {
  it("writes a header row and one data row with numbered asset columns", () => {
    const csv = campaignConfigToCsv(buildCampaignConfig(BASE));
    // Trailing CRLF then split: two lines (header + single RSA row).
    const lines = csv.replace(/\r\n$/, "").split("\r\n");
    expect(lines).toHaveLength(2);

    // 11 fixed columns + Headline 1..15 + Description 1..4
    const header = parseCsvLine(lines[0]);
    expect(header).toHaveLength(30);
    expect(header[0]).toBe("Campaign");
    expect(header[11]).toBe("Headline 1");
    expect(header[25]).toBe("Headline 15");
    expect(header[26]).toBe("Description 1");
    expect(header[29]).toBe("Description 4");

    const row = parseCsvLine(lines[1]);
    expect(row).toHaveLength(30);
    expect(row[0]).toBe("stayradar_lake-tahoe_radius25mi");
    expect(row[7]).toBe("Responsive Search Ad");
    expect(row[9]).toBe("stayradar_lake-tahoe_datesearchers_7d");
    expect(row[10]).toBe("stayradar_lake-tahoe_lead_submitters");
    expect(row[11]).toBe("Book Lake Tahoe Cabins Direct");
    expect(row[15]).toBe(""); // unused Headline 5 slot
    expect(row[29]).toBe(""); // unused Description 4 slot
  });

  it("escapes RFC 4180 metacharacters (quotes, commas) inside fields", () => {
    const config = buildCampaignConfig(BASE);
    config.campaign.ads[0].responsiveSearchAd.headlines = ['He said "book, now"'];
    const csv = campaignConfigToCsv(config);

    // Doubled quotes appear in the raw output…
    expect(csv).toContain('"He said ""book, now"""');
    // …and the field round-trips as ONE cell despite its embedded comma.
    const row = parseCsvLine(csv.replace(/\r\n$/, "").split("\r\n")[1]);
    expect(row).toHaveLength(30);
    expect(row[11]).toBe('He said "book, now"');
  });

  it("omits an absent exclusion list as an empty cell", () => {
    const config = buildCampaignConfig({ ...BASE, cohort: null });
    const row = parseCsvLine(campaignConfigToCsv(config).replace(/\r\n$/, "").split("\r\n")[1]);
    expect(row[10]).toBe("");
  });

  it("is deterministic", () => {
    const config = buildCampaignConfig(BASE);
    expect(campaignConfigToCsv(config)).toBe(campaignConfigToCsv(config));
  });
});

describe("exportFilename", () => {
  it("names attachments after the market and format", () => {
    expect(exportFilename("lake-tahoe", "csv")).toBe("stayradar-lake-tahoe-campaign.csv");
    expect(exportFilename("lake-tahoe", "json")).toBe("stayradar-lake-tahoe-campaign.json");
  });
});
