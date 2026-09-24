import { describe, expect, it } from "vitest";
import {
  CsvConnector,
  CsvParseError,
  parsePropertiesCsv,
} from "@/lib/services/ingestion/csv-connector";

const HEADER =
  "external_id,slug,title,market,property_type,max_guests,bedrooms,base_nightly,latitude,longitude,amenities,address";

describe("parsePropertiesCsv", () => {
  it("parses a well-formed row", () => {
    const csv = [
      HEADER,
      "csv-1,dune-house,Dune House,cape-cod,house,6,3,320,41.68,-70.0,wifi;grill,1 Shore Road",
    ].join("\r\n");
    const inputs = parsePropertiesCsv(csv);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      source: "csv",
      externalId: "csv-1",
      slug: "dune-house",
      title: "Dune House",
      market: "cape-cod",
      propertyType: "house",
      maxGuests: 6,
      bedrooms: 3,
      baseNightly: 320,
      location: { latitude: 41.68, longitude: -70.0 },
      address: "1 Shore Road",
      amenities: ["wifi", "grill"],
    });
  });

  it("handles quoted fields with commas and doubled quotes (RFC 4180)", () => {
    const csv = [
      HEADER,
      'csv-1,quoted-house,"House, ""Deluxe"", ocean side",cape-cod,house,4,2,250,41.5,-70.2,wifi,"12 Broad St, Apt 2"',
    ].join("\r\n");
    const inputs = parsePropertiesCsv(csv);
    expect(inputs[0]?.title).toBe('House, "Deluxe", ocean side');
    expect(inputs[0]?.address).toBe("12 Broad St, Apt 2");
  });

  it("rejects a missing required column", () => {
    const csv = [
      "external_id,slug,title,market,property_type,max_guests,bedrooms,base_nightly,latitude,longitude,amenities",
      "csv-1,x,X,cape-cod,house,4,2,250,41.5,-70.2,wifi",
    ].join("\r\n");
    expect(() => parsePropertiesCsv(csv)).toThrow(/missing columns.*address/i);
  });

  it("rejects invalid numbers with the row number", () => {
    const csv = [
      HEADER,
      "csv-1,x,X,cape-cod,house,4,2,250,91,-70.2,wifi,",
    ].join("\r\n");
    const error = (() => {
      try {
        parsePropertiesCsv(csv);
        return null;
      } catch (caught) {
        return caught as CsvParseError;
      }
    })();
    expect(error).toBeInstanceOf(CsvParseError);
    expect(error?.row).toBe(2);
  });

  it("tolerates extra columns", () => {
    const csv = [
      `${HEADER},notes`,
      "csv-1,x,X,cape-cod,house,4,2,250,41.5,-70.2,wifi,1 Main St,updated 2026",
    ].join("\r\n");
    const inputs = parsePropertiesCsv(csv);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.title).toBe("X");
  });

  it("returns an empty list for an empty body", () => {
    expect(parsePropertiesCsv("\r\n")).toEqual([]);
  });

  it("exposes the CSV text through the connector interface", () => {
    const csv = [
      HEADER,
      "csv-1,x,X,cape-cod,house,4,2,250,41.5,-70.2,wifi,",
    ].join("\r\n");
    const connector = new CsvConnector(csv);
    expect(connector.source).toBe("csv");
    expect(connector.load()).toHaveLength(1);
  });
});
