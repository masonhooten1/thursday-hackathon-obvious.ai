import { afterEach, describe, expect, it, vi } from "vitest";
import { AvailabilityResponseSchema, ParkSchema, type AvailabilityResponse, type Park } from "@campground/shared";
import { createApiSource, normalizeApiBase, resolveDataSource } from "./data-source";

const PARK: Park = { id: "yosemite", name: "Yosemite National Park", state: "California", lat: 37.87, lng: -119.54 };

const AVAILABILITY: AvailabilityResponse = {
  date: "2026-09-24",
  fetchedAt: "2026-09-24T19:50:00.000Z",
  stale: false,
  campgrounds: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeApiBase", () => {
  it("strips trailing slashes", () => {
    expect(normalizeApiBase("https://api.example.com/")).toBe("https://api.example.com");
    expect(normalizeApiBase("https://api.example.com//")).toBe("https://api.example.com");
  });

  it("collapses the same-origin root to an empty base (relative URLs)", () => {
    expect(normalizeApiBase("/")).toBe("");
  });

  it("leaves a clean base untouched", () => {
    expect(normalizeApiBase("https://api.example.com")).toBe("https://api.example.com");
  });
});

describe("resolveDataSource", () => {
  it("falls back to fixtures when EXPO_PUBLIC_API_URL is unset", () => {
    expect(resolveDataSource({ ...process.env }).name).toBe("fixtures");
  });

  it("uses the API source when EXPO_PUBLIC_API_URL is set", () => {
    expect(resolveDataSource({ ...process.env, EXPO_PUBLIC_API_URL: "https://api.example.com" }).name).toBe("api");
  });
});

describe("createApiSource with a same-origin base", () => {
  it("fetches relative /api paths when the base is empty", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = url.toString();
      if (path.endsWith("/api/parks")) return new Response(JSON.stringify([PARK]), { status: 200 });
      return new Response(JSON.stringify(AVAILABILITY), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const source = createApiSource(normalizeApiBase("/"));
    const payload = await source.fetch("2026-09-24");

    expect(payload.parks).toEqual([ParkSchema.parse(PARK)]);
    expect(AvailabilityResponseSchema.parse(payload.availability).date).toBe("2026-09-24");
    const [parksUrl, availabilityUrl] = fetchMock.mock.calls.map((call) => call[0].toString());
    expect(parksUrl).toBe("/api/parks");
    expect(availabilityUrl).toBe("/api/availability?date=2026-09-24");
  });
});
