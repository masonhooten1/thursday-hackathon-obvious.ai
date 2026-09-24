import { describe, expect, it } from "vitest";
import {
  MARKETS,
  PROPERTIES,
  getMarket,
  propertiesByMarket,
} from "@/fixtures/properties";

describe("fixtures/properties", () => {
  it("exports 8 properties across the 2 launch markets", () => {
    expect(PROPERTIES).toHaveLength(8);
    expect(MARKETS.map((market) => market.id)).toEqual([
      "lake-tahoe",
      "gatlinburg",
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

  it("splits inventory evenly between markets", () => {
    expect(propertiesByMarket("lake-tahoe")).toHaveLength(4);
    expect(propertiesByMarket("gatlinburg")).toHaveLength(4);
    expect(propertiesByMarket("nowhere")).toEqual([]);
  });

  it("resolves markets by id and returns undefined for unknown ids", () => {
    expect(getMarket("gatlinburg")?.name).toBe("Gatlinburg");
    expect(getMarket("bogus")).toBeUndefined();
  });

  it("keeps fixture coordinates near their market centroid and values sane", () => {
    for (const property of PROPERTIES) {
      const market = getMarket(property.market);
      if (!market) {
        throw new Error(`fixture references unknown market: ${property.market}`);
      }

      expect(Math.abs(property.latitude - market.center.latitude)).toBeLessThan(0.05);
      expect(Math.abs(property.longitude - market.center.longitude)).toBeLessThan(0.05);
      expect(property.baseNightly).toBeGreaterThan(0);
      expect(property.maxGuests).toBeGreaterThan(0);
      expect(property.bedrooms).toBeGreaterThan(0);
    }
  });
});
