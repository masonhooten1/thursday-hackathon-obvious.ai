import { describe, expect, it } from "vitest";
import type { AvailabilitySnapshot, Park, SiteType } from "@campground/shared";
import type { AvailabilityPayload } from "./data-source";
import {
  buildAvailabilityView,
  countByType,
  countFreeOnNight,
  countFreeWithinSoonWindow,
  isMarkerVisible,
  nightIndex,
} from "./filters";

const NOW = new Date("2026-09-24T20:00:00Z");
const TONIGHT = "2026-09-24";

const PARK: Park = { id: "test-park", name: "Test Park", state: "CA", lat: 37, lng: -119 };

function snapshot(options: {
  capturedAt?: string;
  windowStart?: string;
  nights?: number;
  byType?: Partial<Record<SiteType, number[]>>;
}): AvailabilitySnapshot {
  const nights = options.nights ?? 14;
  const windowStart = options.windowStart ?? TONIGHT;
  const byType = { tent: [], rv: [], cabin: [], group: [], other: [], ...options.byType };
  for (const type of Object.keys(byType) as SiteType[]) {
    while (byType[type].length < nights) byType[type].push(0);
  }
  return {
    facilityId: 1,
    capturedAt: options.capturedAt ?? "2026-09-24T19:50:00Z",
    windowStart,
    nights,
    byType,
    totalSites: 10,
  };
}

function response(entries: Array<Record<string, unknown>>): AvailabilityPayload {
  return {
    parks: [PARK],
    availability: {
      date: TONIGHT,
      fetchedAt: "2026-09-24T19:55:00Z",
      stale: false,
      campgrounds: entries.map((extra, i) => ({
        facilityId: 100 + i,
        parkId: "test-park",
        name: `Camp ${i}`,
        lat: 37,
        lng: -119,
        bookingUrl: `https://www.recreation.gov/camping/campgrounds/${100 + i}`,
        siteTypes: ["tent"] as SiteType[],
        snapshot: null,
        ...extra,
      })),
    },
  } as AvailabilityPayload;
}

describe("nightIndex", () => {
  it("maps dates inside the window", () => {
    const snap = snapshot({});
    expect(nightIndex(snap, TONIGHT)).toBe(0);
    expect(nightIndex(snap, "2026-10-07")).toBe(13);
  });

  it("rejects dates outside the window", () => {
    const snap = snapshot({});
    expect(nightIndex(snap, "2026-09-23")).toBeNull();
    expect(nightIndex(snap, "2026-10-08")).toBeNull();
  });
});

describe("countByType / countFreeOnNight", () => {
  it("sums only the selected types", () => {
    const snap = snapshot({ byType: { tent: [2], rv: [5], cabin: [3], group: [1], other: [7] } });
    expect(countFreeOnNight(snap, ["tent", "rv"], TONIGHT)).toBe(7);
    expect(countFreeOnNight(snap, ["cabin"], TONIGHT)).toBe(3);
    expect(countFreeOnNight(snap, [], TONIGHT)).toBe(0);
  });

  it("counts zero outside the window", () => {
    const snap = snapshot({});
    expect(countFreeOnNight(snap, ["tent"], "2026-12-01")).toBe(0);
  });

  it("handles a missing snapshot", () => {
    expect(countByType(null, TONIGHT)).toEqual({ tent: 0, rv: 0, cabin: 0, group: 0, other: 0 });
  });
});

describe("countFreeWithinSoonWindow", () => {
  it("spans the selected night plus six more", () => {
    const tent = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0]; // night 10 — outside the 7-night window from 0
    const snap = snapshot({ byType: { tent } });
    expect(countFreeWithinSoonWindow(snap, ["tent"], TONIGHT)).toBe(0);
    expect(countFreeWithinSoonWindow(snap, ["tent"], "2026-10-01")).toBe(5); // index 7 → window 7..13
  });

  it("includes the selected night itself", () => {
    const snap = snapshot({ byType: { tent: [1, 0, 0, 0, 0, 0, 0] } });
    expect(countFreeWithinSoonWindow(snap, ["tent"], TONIGHT)).toBe(1);
  });

  it("clamps at the end of the snapshot window", () => {
    const tent = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9];
    const snap = snapshot({ byType: { tent } });
    expect(countFreeWithinSoonWindow(snap, ["tent"], "2026-10-07")).toBe(9); // last night
  });
});

describe("buildAvailabilityView", () => {
  it("is green when the selected types are free on the selected night", () => {
    const view = buildAvailabilityView(
      response([{ snapshot: snapshot({ byType: { tent: [2] } }) }]),
      ["tent"],
      TONIGHT,
      NOW,
    );
    expect(view.campgrounds[0]?.availability).toBe("available");
    expect(view.anyAvailable).toBe(true);
  });

  it("is amber when none tonight but some within 7 days", () => {
    const tent = [0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const view = buildAvailabilityView(
      response([{ snapshot: snapshot({ byType: { tent } }) }]),
      ["tent"],
      TONIGHT,
      NOW,
    );
    expect(view.campgrounds[0]?.availability).toBe("soon");
    expect(view.anyAvailable).toBe(false);
  });

  it("is gray when nothing is free in the horizon", () => {
    const view = buildAvailabilityView(
      response([{ snapshot: snapshot({ byType: { tent: [0, 0, 0] } }) }]),
      ["tent"],
      TONIGHT,
      NOW,
    );
    expect(view.campgrounds[0]?.availability).toBe("none");
  });

  it("respects the type selection when deriving state", () => {
    // rv free tonight, tent not selected → gray; selecting rv → green
    const payload = response([{ snapshot: snapshot({ byType: { rv: [3] } }) }]);
    expect(buildAvailabilityView(payload, ["tent"], TONIGHT, NOW).campgrounds[0]?.availability).toBe("none");
    expect(buildAvailabilityView(payload, ["rv"], TONIGHT, NOW).campgrounds[0]?.availability).toBe("available");
  });

  it("classifies freshness tiers per the spec table", () => {
    const view = buildAvailabilityView(
      response([
        { snapshot: snapshot({ capturedAt: "2026-09-24T19:50:00Z" }) }, // 10 min → fresh
        { snapshot: snapshot({ capturedAt: "2026-09-24T19:20:00Z" }) }, // 40 min → aging
        { snapshot: snapshot({ capturedAt: "2026-09-24T18:30:00Z" }) }, // 90 min → stale
        { snapshot: null }, // never
      ]),
      ["tent"],
      TONIGHT,
      NOW,
    );
    expect(view.campgrounds.map((c) => c.freshness)).toEqual(["fresh", "aging", "stale", "never"]);
  });

  it("treats never-snapshot campgrounds as unavailable and hidden", () => {
    const view = buildAvailabilityView(response([{ snapshot: null }]), ["tent"], TONIGHT, NOW);
    const entry = view.campgrounds[0]!;
    expect(entry.availability).toBe("none");
    expect(isMarkerVisible(entry)).toBe(false);
    expect(isMarkerVisible({ ...entry, freshness: "stale" })).toBe(true);
  });

  it("joins parks and exposes the latest snapshot time", () => {
    const view = buildAvailabilityView(
      response([
        { snapshot: snapshot({ capturedAt: "2026-09-24T19:50:00Z" }) },
        { snapshot: snapshot({ capturedAt: "2026-09-24T19:55:00Z" }) },
      ]),
      ["tent"],
      TONIGHT,
      NOW,
    );
    expect(view.campgrounds[0]?.park).toEqual(PARK);
    expect(view.latestCapturedAt).toBe("2026-09-24T19:55:00Z");
  });
});
