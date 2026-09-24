import { describe, expect, it } from "vitest";
import type { AvailabilityResponse } from "@campground/shared";
import { buildFixtureAvailability, FIXTURE_PARKS } from "./fixtures";
import { countFreeWithinSoonWindow } from "./filters";

// One fixed instant; the fixture builder derives tonight/windowStart from it.
// The expected night is read back from the response so the test is
// timezone-independent (toISODate is local-calendar based).
const NOW = new Date("2026-09-24T20:00:00Z");

describe("fixture catalog", () => {
  it("covers six marquee parks", () => {
    expect(FIXTURE_PARKS).toHaveLength(6);
  });

  it("builds 18 campgrounds with unique facility ids and valid booking URLs", () => {
    const response: AvailabilityResponse = buildFixtureAvailability(NOW);
    expect(response.campgrounds).toHaveLength(18);
    const ids = new Set(response.campgrounds.map((c) => c.facilityId));
    expect(ids.size).toBe(18);
    for (const campground of response.campgrounds) {
      expect(campground.bookingUrl).toBe(
        `https://www.recreation.gov/camping/campgrounds/${campground.facilityId}`,
      );
      expect(Number.isFinite(campground.lat)).toBe(true);
      expect(Number.isFinite(campground.lng)).toBe(true);
    }
  });

  it("every campground belongs to a known park", () => {
    const response = buildFixtureAvailability(NOW);
    const parkIds = new Set(FIXTURE_PARKS.map((p) => p.id));
    for (const campground of response.campgrounds) {
      expect(parkIds.has(campground.parkId)).toBe(true);
    }
  });
});

describe("buildFixtureAvailability", () => {
  const response = buildFixtureAvailability(NOW);
  const tonight = response.date;

  it("returns a contract-valid response windowed on tonight", () => {
    // The fixture builder already parses with AvailabilityResponseSchema — a
    // throw there means the fixtures drifted from the wire format.
    expect(response.date).toBe(tonight);
    expect(response.stale).toBe(false);
    for (const campground of response.campgrounds) {
      if (campground.snapshot) {
        expect(campground.snapshot.windowStart).toBe(tonight);
        expect(campground.snapshot.nights).toBe(14);
        expect(campground.snapshot.byType.tent).toHaveLength(14);
      }
    }
  });

  it("covers the never-snapshot case and several snapshot ages", () => {
    const captured = response.campgrounds
      .filter((c) => c.snapshot)
      .map((c) => c.snapshot!.capturedAt);
    expect(captured.length).toBeLessThan(18); // some campground has no snapshot at all
    expect(new Set(captured).size).toBeGreaterThan(1); // fresh + aging + stale mix
  });

  it("exposes green, amber, and gray marker states for tent tonight", () => {
    const states = response.campgrounds.map((c) => {
      if (!c.snapshot) return "never";
      if (countFreeWithinSoonWindow(c.snapshot, ["tent"], tonight) === 0) return "gray";
      return c.snapshot.byType.tent[0]! > 0 ? "green" : "amber";
    });
    expect(new Set(states)).toEqual(new Set(["green", "amber", "gray", "never"]));
  });
});
