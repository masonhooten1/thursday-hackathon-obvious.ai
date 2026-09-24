import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AvailabilitySnapshotSchema } from "@campground/shared";
import { PoliteClient } from "./politeness";
import {
  monthStarts,
  parseMonthResponse,
  RecreationGovAvailability,
  windowDates,
} from "./recreation-gov";

const UA = "CampgroundTonight/0.1 (test)";

/** The live-captured September response excerpt (real records, see discovery doc). */
const SEPTEMBER_FIXTURE: unknown = JSON.parse(
  readFileSync(new URL("./__fixtures__/recreation-gov-month-232490.json", import.meta.url), "utf8"),
);

/** Serves fixture bodies keyed by the requested month's first day. */
function serveByMonth(months: Record<string, unknown>): { client: PoliteClient; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = String(input);
    urls.push(url);
    const encoded = /start_date=([^&]+)/.exec(url)?.[1] ?? "";
    const monthStart = decodeURIComponent(encoded).slice(0, 10);
    const body = months[monthStart];
    if (body === undefined) {
      return Promise.reject(new Error(`unexpected month requested: ${monthStart} (${url})`));
    }
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return { client: new PoliteClient({ userAgent: UA, fetchImpl, sleep: async () => {} }), urls };
}

const adapterFor = (months: Record<string, unknown>) => {
  const { client, urls } = serveByMonth(months);
  return { adapter: new RecreationGovAvailability(client), urls };
};

describe("parseMonthResponse", () => {
  it("throws on a response without a campsites object", () => {
    expect(() => parseMonthResponse({})).toThrow(/campsites/);
    expect(() => parseMonthResponse({ camps: {} })).toThrow(/campsites/);
    expect(() => parseMonthResponse(null)).toThrow(/campsites/);
  });

  it("counts only the literal Available state", () => {
    const parsed = parseMonthResponse({
      campsites: {
        1: {
          campsite_type: "STANDARD NONELECTRIC",
          availabilities: {
            "2026-09-01T00:00:00Z": "Available",
            "2026-09-02T00:00:00Z": "Reserved",
            "2026-09-03T00:00:00Z": "Not Available Cutoff",
            "2026-09-04T00:00:00Z": "Closed",
            // A future state must not silently count as available.
            "2026-09-05T00:00:00Z": "Available (walk-up)",
          },
        },
      },
    });
    expect(parsed.get(1)?.availableDates).toEqual(new Set(["2026-09-01"]));
  });

  it("ignores malformed date keys and non-object records", () => {
    const parsed = parseMonthResponse({
      campsites: {
        1: { campsite_type: "RV NONELECTRIC", availabilities: { "not-a-date": "Available" } },
        broken: { campsite_type: "RV NONELECTRIC", availabilities: {} },
        2: "not an object",
      },
    });
    expect(parsed.size).toBe(1);
    expect(parsed.get(1)?.availableDates.size).toBe(0);
  });
});

describe("windowDates and monthStarts", () => {
  it("generates consecutive UTC calendar dates", () => {
    expect(windowDates("2026-09-28", 5)).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("collects distinct month first-days in order", () => {
    expect(monthStarts(windowDates("2026-09-24", 14))).toEqual(["2026-09-01", "2026-10-01"]);
    expect(monthStarts(windowDates("2026-09-01", 14))).toEqual(["2026-09-01"]);
  });

  it("rejects a malformed window start", () => {
    expect(() => windowDates("not-a-date", 3)).toThrow(/windowStart/);
  });
});

describe("RecreationGovAvailability", () => {
  it("requests the exact endpoint shape discovered live", async () => {
    const { adapter, urls } = adapterFor({ "2026-09-01": SEPTEMBER_FIXTURE });
    await adapter.fetchFacilityAvailability(232490, new Date("2026-09-24T12:00:00Z"), 7);
    expect(urls).toEqual([
      "https://www.recreation.gov/api/camps/availability/campground/232490/month?start_date=2026-09-01T00%3A00%3A00.000Z",
    ]);
  });

  it("normalizes the recorded fixture into a contract-valid snapshot (mixed site types)", async () => {
    const { adapter } = adapterFor({ "2026-09-01": SEPTEMBER_FIXTURE });
    const snapshot = await adapter.fetchFacilityAvailability(
      232490,
      new Date("2026-09-24T12:00:00Z"),
      7,
    );
    // Hand-derived from the fixture's nine records (window Sep 24-30):
    // tent = STANDARD + TENT ONLY records, group = GROUP TENT ONLY records,
    // other = EQUESTRIAN record; 4085 (RV) is Reserved all month, 999901 is empty.
    expect(snapshot).toEqual({
      facilityId: 232490,
      capturedAt: expect.any(String),
      windowStart: "2026-09-24",
      nights: 7,
      byType: {
        tent: [2, 1, 2, 2, 2, 2, 2],
        rv: [0, 0, 0, 0, 0, 0, 0],
        cabin: [0, 0, 0, 0, 0, 0, 0],
        group: [1, 0, 1, 2, 1, 1, 1],
        other: [1, 1, 0, 0, 0, 0, 0],
      },
      totalSites: 9,
    });
    expect(AvailabilitySnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("fetches and merges both months for a window crossing a month boundary", async () => {
    const october = {
      campsites: {
        4300: {
          campsite_type: "RV NONELECTRIC",
          availabilities: {
            "2026-10-01T00:00:00Z": "Available",
            "2026-10-02T00:00:00Z": "Available",
          },
        },
        4301: {
          campsite_type: "CABIN NONELECTRIC",
          availabilities: { "2026-10-01T00:00:00Z": "Available" },
        },
      },
      count: 2,
    };
    const { adapter, urls } = adapterFor({ "2026-09-01": SEPTEMBER_FIXTURE, "2026-10-01": october });
    const snapshot = await adapter.fetchFacilityAvailability(
      232490,
      new Date("2026-09-28T12:00:00Z"),
      14,
    );
    expect(urls).toHaveLength(2);
    expect(snapshot.totalSites).toBe(11); // 9 September + 2 October records
    // Sep 28-30 (indices 0-2): tent 4122+4087/4086, group 4181; Oct 1-2 (indices
    // 3-4): rv 4300, cabin 4301.
    expect(snapshot.byType.tent).toEqual([2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(snapshot.byType.rv).toEqual([0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(snapshot.byType.cabin).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(snapshot.byType.group).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(snapshot.byType.other).toEqual(Array.from({ length: 14 }, () => 0));
  });

  it("maps unknown and missing campsite types to other", async () => {
    const response = {
      campsites: {
        1: { campsite_type: "YURT", availabilities: { "2026-09-01T00:00:00Z": "Available" } },
        2: { campsite_type: "LODGING: HOTEL BLOCK", availabilities: { "2026-09-02T00:00:00Z": "Available" } },
        3: { availabilities: { "2026-09-03T00:00:00Z": "Available" } },
      },
      count: 3,
    };
    const { adapter } = adapterFor({ "2026-09-01": response });
    const snapshot = await adapter.fetchFacilityAvailability(232490, new Date("2026-09-01T00:00:00Z"), 3);
    expect(snapshot.byType.other).toEqual([1, 1, 1]);
    expect(snapshot.byType.tent).toEqual([0, 0, 0]);
    expect(snapshot.totalSites).toBe(3);
  });

  it("keeps a contract-valid all-zero snapshot for empty ranges", async () => {
    // Only the synthetic empty-availabilities record — no reservable nights.
    const fixture = SEPTEMBER_FIXTURE as { campsites: Record<string, unknown> };
    const emptyOnly = { campsites: { 999901: fixture.campsites["999901"] }, count: 1 };
    const { adapter } = adapterFor({ "2026-09-01": emptyOnly });
    const snapshot = await adapter.fetchFacilityAvailability(
      232490,
      new Date("2026-09-24T12:00:00Z"),
      7,
    );
    expect(snapshot.byType.tent).toEqual(Array.from({ length: 7 }, () => 0));
    expect(snapshot.totalSites).toBe(1);
    expect(AvailabilitySnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("returns a zero-snapshot when the campground has no campsite records", async () => {
    const { adapter } = adapterFor({ "2026-09-01": { campsites: {}, count: 0 } });
    const snapshot = await adapter.fetchFacilityAvailability(232490, new Date("2026-09-24T12:00:00Z"), 7);
    expect(snapshot.totalSites).toBe(0);
    expect(AvailabilitySnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("propagates source failures instead of fabricating data", async () => {
    const { client } = serveByMonth({});
    const adapter = new RecreationGovAvailability(client);
    await expect(
      adapter.fetchFacilityAvailability(232490, new Date("2026-09-24T12:00:00Z"), 7),
    ).rejects.toThrow();
  });
});
