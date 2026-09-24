import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as exportRoute } from "@/app/api/campaigns/[id]/export/route";
import { GET as listRoute } from "@/app/api/campaigns/route";
import { POST as generateRoute } from "@/app/api/campaigns/generate/route";
import { createDb } from "@/db";
import { applyMigrations, truncateAll } from "@/db/apply-migrations";
import { leads, properties, searchEvents } from "@/db/schema";
import { MockGoogleAdsClient } from "@/lib/services/marketing/ads-client";
import {
  CampaignValidationError,
  MarketNotFoundError,
  generateCampaign,
  getCampaign,
  listCampaigns,
} from "@/lib/services/marketing/campaign-service";
import { getMarketingDb } from "@/lib/services/marketing/connection";
import type { CampaignConfig } from "@/lib/services/marketing/schemas";
import { ingestProperties } from "@/lib/services/ingestion/ingest";
import { SeedConnector } from "@/lib/services/ingestion/seed-connector";

/**
 * Persistence round-trip against a real Postgres 16 + PostGIS database (CI:
 * postgis/postgis:16-3.5 service container; local: see stayradar/README.md).
 * Without TEST_DATABASE_URL these tests skip. Route handlers are exercised
 * directly — they are thin adapters over the same services.
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("marketing engine persistence", () => {
  // ReturnType carries the `$client` pool handle that createDb attaches.
  let db: ReturnType<typeof createDb>;
  let lakeTahoePropertyId: string;

  beforeAll(async () => {
    db = createDb(databaseUrl as string);
    await applyMigrations(db);
    await truncateAll(db);

    // Real market clusters: the full 40-property seed (ingest is idempotent).
    await ingestProperties(db, new SeedConnector().load());
    const [property] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.market, "lake-tahoe"))
      .limit(1);
    lakeTahoePropertyId = property.id;

    // First-party signals: two dated searchers (7d window), one browser, one lead.
    const day = (offset: number) =>
      new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    await db.insert(searchEvents).values([
      {
        sessionHash: "dated-a",
        market: "lake-tahoe",
        checkIn: day(3),
        checkOut: day(8),
        guests: 2,
      },
      {
        sessionHash: "dated-b",
        market: "lake-tahoe",
        checkIn: day(3),
        checkOut: day(8),
        guests: 2,
      },
      { sessionHash: "browser-c", market: "lake-tahoe", utm: { utm_source: "dallas" } },
    ]);
    await db.insert(leads).values({
      propertyId: lakeTahoePropertyId,
      name: "Lead Submitter",
      email: "lead@example.com",
    });
  });

  afterAll(async () => {
    // Two pools exist: the test's own and the route handlers' lazy singleton.
    await Promise.all([db.$client.end(), getMarketingDb().$client.end()]);
  });

  describe("generateCampaign", () => {
    it("persists the delivered config with the mock client's resource name", async () => {
      const client = new MockGoogleAdsClient();
      const row = await generateCampaign(db, { market: "lake-tahoe" }, { adsClient: client });
      const config = row.config as CampaignConfig;

      expect(row.market).toBe("lake-tahoe");
      expect(row.status).toBe("generated");
      expect(row.radiusMeters).toBe(40234);
      expect(config.campaign.name).toBe("stayradar_lake-tahoe_radius25mi");
      expect(config.campaign.delivery).toEqual({
        client: "mock",
        resourceName: expect.stringMatching(/^customers\/mock-0001\/campaigns\//),
        submittedAt: expect.any(String),
      });

      // The client was shown the config exactly as composed; the stored copy
      // adds only the delivery stamp.
      const [submission] = client.getSubmissions();
      expect(submission.resourceName).toBe(config.campaign.delivery.resourceName);
      const submittedWithDelivery = structuredClone(submission.config) as CampaignConfig;
      submittedWithDelivery.campaign.delivery = config.campaign.delivery;
      expect(config).toEqual(submittedWithDelivery);

      const stored = await getCampaign(db, row.id);
      expect(stored).not.toBeNull();
      expect(stored?.status).toBe("generated");
      expect(stored?.config).toEqual(row.config);
    });

    it("rejects a sub-1km radius with nothing persisted", async () => {
      const before = await listCampaigns(db);
      await expect(
        generateCampaign(
          db,
          { market: "lake-tahoe", radiusMeters: 500 },
          { adsClient: new MockGoogleAdsClient() },
        ),
      ).rejects.toBeInstanceOf(CampaignValidationError);
      expect(await listCampaigns(db)).toHaveLength(before.length);
    });

    it("rejects an unknown market with MarketNotFoundError", async () => {
      await expect(
        generateCampaign(db, { market: "nowhere" }, { adsClient: new MockGoogleAdsClient() }),
      ).rejects.toBeInstanceOf(MarketNotFoundError);
    });
  });

  describe("listCampaigns", () => {
    it("returns rows newest-first and filters by market", async () => {
      await generateCampaign(
        db,
        { market: "gatlinburg" },
        { adsClient: new MockGoogleAdsClient() },
      );
      const all = await listCampaigns(db);
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(all.map((c) => c.market)).toContain("gatlinburg");

      const tahoe = await listCampaigns(db, "lake-tahoe");
      expect(tahoe.length).toBeGreaterThanOrEqual(1);
      expect(tahoe.every((c) => c.market === "lake-tahoe")).toBe(true);
    });
  });

  describe("campaign routes", () => {
    it("POST /api/campaigns/generate → 201 with the persisted campaign", async () => {
      const response = await generateRoute(
        new Request("http://localhost/api/campaigns/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ market: "lake-tahoe" }),
        }),
      );
      expect(response.status).toBe(201);
      const body = (await response.json()) as { campaign: { config: CampaignConfig } };
      expect(body.campaign.config.campaign.delivery.client).toBe("mock");
    });

    it("POST /api/campaigns/generate → 400 malformed JSON, 400 below the radius floor, 404 unknown market", async () => {
      const badJson = await generateRoute(
        new Request("http://localhost/api/campaigns/generate", {
          method: "POST",
          body: "not-json",
        }),
      );
      expect(badJson.status).toBe(400);

      const badBody = await generateRoute(
        new Request("http://localhost/api/campaigns/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ market: "lake-tahoe", radiusMeters: 500 }),
        }),
      );
      expect(badBody.status).toBe(400);
      const badBodyJson = (await badBody.json()) as { error: string; issues: { message: string }[] };
      expect(badBodyJson.issues.map((issue) => issue.message).join(" ")).toMatch(/1 km/);

      const unknownMarket = await generateRoute(
        new Request("http://localhost/api/campaigns/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ market: "nowhere" }),
        }),
      );
      expect(unknownMarket.status).toBe(404);
    });

    it("GET /api/campaigns lists stored campaigns", async () => {
      const response = await listRoute(new Request("http://localhost/api/campaigns?market=lake-tahoe"));
      expect(response.status).toBe(200);
      const body = (await response.json()) as { campaigns: { market: string }[] };
      expect(body.campaigns.length).toBeGreaterThanOrEqual(2);
      expect(body.campaigns.every((c) => c.market === "lake-tahoe")).toBe(true);
    });

    it("GET /api/campaigns/[id]/export round-trips JSON and CSV and marks the campaign exported", async () => {
      const row = await generateCampaign(
        db,
        { market: "lake-tahoe" },
        { adsClient: new MockGoogleAdsClient() },
      );

      const json = await exportRoute(
        new Request(`http://localhost/api/campaigns/${row.id}/export`),
        { params: Promise.resolve({ id: row.id }) },
      );
      expect(json.status).toBe(200);
      expect(json.headers.get("content-type")).toBe("application/json");
      expect(json.headers.get("content-disposition")).toBe(
        'attachment; filename="stayradar-lake-tahoe-campaign.json"',
      );
      expect(JSON.parse(await json.text())).toEqual(row.config);

      const csv = await exportRoute(
        new Request(`http://localhost/api/campaigns/${row.id}/export?format=csv`),
        { params: Promise.resolve({ id: row.id }) },
      );
      expect(csv.status).toBe(200);
      expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(await csv.text()).toContain('"stayradar_lake-tahoe_radius25mi"');

      const after = await getCampaign(db, row.id);
      expect(after?.status).toBe("exported");
    });

    it("GET /api/campaigns/[id]/export → 404 for malformed and unknown ids", async () => {
      const badId = await exportRoute(
        new Request("http://localhost/api/campaigns/not-a-uuid/export"),
        { params: Promise.resolve({ id: "not-a-uuid" }) },
      );
      expect(badId.status).toBe(404);

      const missing = await exportRoute(
        new Request("http://localhost/api/campaigns/00000000-0000-0000-0000-000000000000/export"),
        { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
      );
      expect(missing.status).toBe(404);
    });
  });
});
