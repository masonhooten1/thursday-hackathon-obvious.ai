import { describe, expect, it } from "vitest";
import {
  MARKETS,
  PROPERTIES,
  getMarket,
  propertiesByMarket,
} from "@/fixtures/properties";

describe("fixtures/properties", () => {
  it("exports 40 properties across the 4 launch markets", () => {
    expect(PROPERTIES).toHaveLength(40);
    expect(MARKETS.map((market) => market.id)).toEqual([
      "lake-tahoe",
      "gatlinburg",
      "austin",
      "cape-cod",
    ]);
  });

  it("gives every property a unique slug and a known market", () => {
    const slugs = PROPERTIES.map((property) => property.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    const marketIds = new Set(MARKETS.map((market) => market.id));
    for (const property of PROPERTIES) {
      expect(marketIds.has(property.market)).toBe(true);
    }
  });

  it("splits inventory evenly across markets (10 each)", () => {
    expect(propertiesByMarket("lake-tahoe")).toHaveLength(10);
    expect(propertiesByMarket("gatlinburg")).toHaveLength(10);
    expect(propertiesByMarket("austin")).toHaveLength(10);
    expect(propertiesByMarket("cape-cod")).toHaveLength(10);
    expect(propertiesByMarket("nowhere")).toEqual([]);
  });

  it("resolves markets by id and returns undefined for unknown ids", () => {
    expect(getMarket("gatlinburg")?.name).toBe("Gatlinburg");
    expect(getMarket("cape-cod")?.name).toBe("Cape Cod");
    expect(getMarket("bogus")).toBeUndefined();
  });

  it("keeps fixture coordinates near their market centroid and values sane", () => {
    for (const property of PROPERTIES) {
      const market = getMarket(property.market);
      if (!market) {
        throw new Error(`fixture references unknown market: ${property.market}`);
      }

      // The 25 mi campaign radius is ~0.36° of latitude; every fixture stays
      // inside it on both axes so a market's cluster targets as one group.
      expect(Math.abs(property.latitude - market.center.latitude)).toBeLessThan(0.35);
      expect(Math.abs(property.longitude - market.center.longitude)).toBeLessThan(0.35);
      expect(property.baseNightly).toBeGreaterThan(0);
      expect(property.maxGuests).toBeGreaterThan(0);
      expect(property.bedrooms).toBeGreaterThan(0);
    }
  });
});
