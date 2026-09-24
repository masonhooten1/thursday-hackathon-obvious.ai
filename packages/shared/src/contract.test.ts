import { describe, expect, it } from "vitest";
import {
  AvailabilityResponseSchema,
  AvailabilitySnapshotSchema,
  CampgroundSchema,
  SITE_TYPES,
} from "./contract";

// The example payload from the MVP spec, kept here as the fixture of record.
const specExample = {
  date: "2026-09-25",
  fetchedAt: "2026-09-24T19:50:11Z",
  stale: false,
  campgrounds: [
    {
      facilityId: 232490,
      parkId: "grand-canyon",
      name: "Mather Campground",
      lat: 36.0616,
      lng: -112.1082,
      bookingUrl: "https://www.recreation.gov/camping/campgrounds/232490",
      siteTypes: ["tent", "rv", "group"],
      snapshot: {
        facilityId: 232490,
        capturedAt: "2026-09-24T19:45:02Z",
        windowStart: "2026-09-24",
        nights: 14,
        byType: {
          tent: [3, 2, 5, 1, 0, 4, 6, 2, 3, 5, 7, 1, 2, 4],
          rv: [0, 0, 1, 0, 0, 2, 1, 0, 0, 1, 0, 0, 2, 0],
          cabin: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          group: [1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0],
          other: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        },
        totalSites: 327,
      },
    },
  ],
};

const campground = specExample.campgrounds[0];
const snapshot = campground?.snapshot;
if (!campground || !snapshot) {
  throw new Error("spec fixture is malformed");
}

describe("AvailabilityResponseSchema", () => {
  it("accepts the spec example payload", () => {
    const parsed = AvailabilityResponseSchema.parse(specExample);
    expect(parsed.campgrounds[0]?.name).toBe("Mather Campground");
    expect(parsed.campgrounds[0]?.snapshot?.byType.tent[0]).toBe(3);
  });

  it("rejects unknown site types", () => {
    expect(() => CampgroundSchema.parse({ ...campground, siteTypes: ["yurt"] })).toThrow();
  });

  it("rejects snapshots whose byType arrays do not cover the window", () => {
    expect(() =>
      AvailabilitySnapshotSchema.parse({ ...snapshot, byType: { ...snapshot.byType, tent: [3] } }),
    ).toThrow();
  });

  it("rejects snapshots missing a site-type key", () => {
    const { byType } = snapshot;
    const missingCabin = {
      tent: byType.tent,
      rv: byType.rv,
      group: byType.group,
      other: byType.other,
    };
    expect(() => AvailabilitySnapshotSchema.parse({ ...snapshot, byType: missingCabin })).toThrow();
  });

  it("exposes all five normalized site types", () => {
    expect(SITE_TYPES).toEqual(["tent", "rv", "cabin", "group", "other"]);
  });
});
