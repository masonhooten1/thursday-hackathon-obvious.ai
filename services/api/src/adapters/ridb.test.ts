import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CampgroundSchema } from "@campground/shared";
import { PoliteClient } from "./politeness";
import { parseCampsiteTypes, parseFacility, RidbMetadataSource } from "./ridb";

const API_KEY = "test-key";
const UA = "CampgroundTonight/0.1 (test)";

/**
 * Reconstructed from the documented RIDB schema (not a live capture — the
 * stored RIDB_API_KEY was rejected as a placeholder; see the fixture's
 * _provenance field and docs/recreation-gov-endpoints.md).
 */
const SCHEMA_FIXTURE: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./__fixtures__/ridb-facility-232490.json", import.meta.url), "utf8"),
);

/** Serves the fixture's pages by parsed limit/offset, recording requests. */
function servePages(pageSize: number): {
  client: PoliteClient;
  requests: { url: string; headers: Headers }[];
} {
  const pages = [
    SCHEMA_FIXTURE.campsitesPage1,
    SCHEMA_FIXTURE.campsitesPage2,
    SCHEMA_FIXTURE.campsitesPage3,
  ] as Record<string, unknown>[];
  const requests: { url: string; headers: Headers }[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (!url.includes("/campsites?")) {
      requests.push({ url, headers });
      return Promise.resolve(new Response(JSON.stringify(SCHEMA_FIXTURE.facility), { status: 200 }));
    }
    requests.push({ url, headers });
    const offset = Number(/offset=(\d+)/.exec(url)?.[1] ?? "-1");
    const limit = Number(/limit=(\d+)/.exec(url)?.[1] ?? "-1");
    if (limit !== pageSize) return Promise.reject(new Error(`unexpected limit ${limit} in ${url}`));
    const page = pages[offset / pageSize];
    if (page === undefined) return Promise.reject(new Error(`unexpected offset ${offset} in ${url}`));
    return Promise.resolve(new Response(JSON.stringify(page), { status: 200 }));
  };
  return { client: new PoliteClient({ userAgent: UA, fetchImpl, sleep: async () => {} }), requests };
}

const sourceFor = (pageSize = 3) => {
  const { client, requests } = servePages(pageSize);
  return {
    requests,
    source: new RidbMetadataSource({
      apiKey: API_KEY,
      client,
      parkIdFor: (facility) => (facility.id === 232490 ? "grand-canyon" : "unknown"),
      pageSize,
    }),
  };
};

describe("parseFacility", () => {
  it("parses the documented facility fields, coercing ids", () => {
    const facility = parseFacility(SCHEMA_FIXTURE.facility);
    expect(facility).toEqual({
      id: 232490,
      name: "Mather Campground",
      lat: 36.0616,
      lng: -112.1082,
    });
  });

  it("throws on missing name or coordinates instead of fabricating metadata", () => {
    expect(() => parseFacility({ FacilityID: 232490 })).toThrow(/missing required fields/);
    expect(() => parseFacility({ FacilityID: 232490, FacilityName: "X", FacilityLatitude: 1 })).toThrow(
      /missing required fields/,
    );
    expect(() => parseFacility("not an object")).toThrow(/not an object/);
  });
});

describe("parseCampsiteTypes", () => {
  it("normalizes mixed types and ignores records without a type", () => {
    const types = parseCampsiteTypes({
      RECDATA: [
        { CampsiteType: "STANDARD NONELECTRIC" },
        { CampsiteType: "RV NONELECTRIC" },
        { CampsiteType: "GROUP TENT ONLY AREA NONELECTRIC" },
        { CampsiteType: "YURT" },
        { CampsiteType: null },
        "not an object",
      ],
    });
    expect(types).toEqual(["tent", "rv", "group", "other"]);
  });

  it("throws when the RECDATA envelope is missing", () => {
    expect(() => parseCampsiteTypes({})).toThrow(/RECDATA/);
    expect(() => parseCampsiteTypes(null)).toThrow(/RECDATA/);
  });
});

describe("RidbMetadataSource", () => {
  it("builds a contract-valid Campground from the fixture pages", async () => {
    const { source } = sourceFor();
    const campground = await source.fetchFacility(232490);
    expect(campground).toEqual({
      facilityId: 232490,
      parkId: "grand-canyon",
      name: "Mather Campground",
      lat: 36.0616,
      lng: -112.1082,
      bookingUrl: "https://www.recreation.gov/camping/campgrounds/232490",
      // All five contract types appear across the pages (incl. YURT -> other),
      // ordered by the shared contract.
      siteTypes: ["tent", "rv", "cabin", "group", "other"],
    });
    expect(CampgroundSchema.safeParse(campground).success).toBe(true);
  });

  it("sends the identifying User-Agent and apikey header on every request", async () => {
    const { source, requests } = sourceFor();
    await source.fetchFacility(232490);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    for (const request of requests) {
      expect(request.headers.get("apikey")).toBe(API_KEY);
      expect(request.headers.get("User-Agent")).toBe(UA);
    }
  });

  it("pages campsites until a short page", async () => {
    const { source, requests } = sourceFor(3);
    await source.fetchFacility(232490);
    expect(requests).toHaveLength(4); // facility + 3 campsite pages
    expect(requests.map((request) => request.url)).toEqual([
      "https://ridb.recreation.gov/api/v1/facilities/232490",
      "https://ridb.recreation.gov/api/v1/facilities/232490/campsites?limit=3&offset=0",
      "https://ridb.recreation.gov/api/v1/facilities/232490/campsites?limit=3&offset=3",
      "https://ridb.recreation.gov/api/v1/facilities/232490/campsites?limit=3&offset=6",
    ]);
  });

  it("propagates source failures instead of fabricating data", async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new Error("source unreachable"));
    const failing = new RidbMetadataSource({
      apiKey: API_KEY,
      client: new PoliteClient({ userAgent: UA, fetchImpl, sleep: async () => {} }),
      parkIdFor: () => "grand-canyon",
      pageSize: 3,
    });
    await expect(failing.fetchFacility(232490)).rejects.toThrow(/source unreachable/);
  });
});
