import { describe, expect, it } from "vitest";
import { MockGoogleAdsClient, getAdsClient } from "@/lib/services/marketing/ads-client";
import { buildCampaignConfig, type CampaignClusterInput } from "@/lib/services/marketing/campaign-service";
import { CAMPAIGN_DEFAULT_RADIUS_METERS } from "@/lib/services/marketing/schemas";

/**
 * Mock-client tests: fully deterministic, no network. The live client is a
 * credential-gated later swap at the same interface.
 */

function configFor(price: number) {
  const input: CampaignClusterInput = {
    market: "lake-tahoe",
    marketName: "Lake Tahoe",
    centroid: { latitude: 39.0968, longitude: -120.0324 },
    propertyCount: 10,
    typeCounts: { cabin: 6, condo: 4 },
    minNightly: price,
    radiusMeters: CAMPAIGN_DEFAULT_RADIUS_METERS,
    cohort: null,
    generatedAt: new Date("2026-09-24T12:00:00.000Z"),
  };
  return buildCampaignConfig(input);
}

describe("MockGoogleAdsClient", () => {
  it("returns the same resource name for the same config, different for another", async () => {
    const client = new MockGoogleAdsClient();
    const first = await client.createCampaign(configFor(199));
    const repeat = await client.createCampaign(configFor(199));
    const other = await client.createCampaign(configFor(249));

    expect(repeat.resourceName).toBe(first.resourceName);
    expect(other.resourceName).not.toBe(first.resourceName);
    expect(first.resourceName).toMatch(/^customers\/mock-0001\/campaigns\/[0-9a-f]{12}$/);
  });

  it("records every payload it accepts, in order, as deep copies", async () => {
    const client = new MockGoogleAdsClient();
    const config = configFor(199);
    const { resourceName } = await client.createCampaign(config);

    const submissions = client.getSubmissions();
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({ sequence: 1, resourceName });
    expect(submissions[0].config).toEqual(config);

    // Mutating the returned log cannot rewrite the recorded history.
    submissions[0].config.campaign.name = "tampered";
    expect(client.getSubmissions()[0].config.campaign.name).toBe(config.campaign.name);
  });

  it("sequences multiple submissions and resets cleanly", async () => {
    const client = new MockGoogleAdsClient();
    await client.createCampaign(configFor(199));
    await client.createCampaign(configFor(249));
    expect(client.getSubmissions().map((s) => s.sequence)).toEqual([1, 2]);

    client.reset();
    expect(client.getSubmissions()).toEqual([]);
    const fresh = await client.createCampaign(configFor(199));
    expect(client.getSubmissions()[0].sequence).toBe(1);
    expect(client.getSubmissions()[0].resourceName).toBe(fresh.resourceName);
  });

  it("isolates instances and exposes the mock client name", async () => {
    const a = new MockGoogleAdsClient();
    const b = new MockGoogleAdsClient();
    await a.createCampaign(configFor(199));
    expect(b.getSubmissions()).toHaveLength(0);
    expect(a.clientName).toBe("mock");
  });

  it("is the default client until a credential-gated live client ships", () => {
    expect(getAdsClient().clientName).toBe("mock");
  });
});
