import { describe, expect, it } from "vitest";
import { classifyPageStatus, healthCheckCampgrounds } from "./health";
import type { Campground } from "@campground/shared";

function campgroundWithId(facilityId: number): Campground {
  return {
    facilityId,
    parkId: "zion",
    name: `Campground ${facilityId}`,
    lat: 37.2,
    lng: -112.98,
    bookingUrl: `https://www.recreation.gov/camping/campgrounds/${facilityId}`,
    siteTypes: ["tent"],
  };
}

describe("classifyPageStatus", () => {
  it("maps 200 to alive", () => {
    expect(classifyPageStatus(200)).toBe("alive");
  });

  it("maps 404 to dead", () => {
    expect(classifyPageStatus(404)).toBe("dead");
  });

  it("maps blocks, throttles, server errors, and network failures to unverified", () => {
    expect(classifyPageStatus(403)).toBe("unverified");
    expect(classifyPageStatus(429)).toBe("unverified");
    expect(classifyPageStatus(500)).toBe("unverified");
    expect(classifyPageStatus(405)).toBe("unverified");
    expect(classifyPageStatus(null)).toBe("unverified");
  });
});

describe("healthCheckCampgrounds", () => {
  it("aggregates alive, dead, and unverified ids from a fake page checker", async () => {
    const campgrounds = [11, 22, 33, 44].map(campgroundWithId);
    const statusById = new Map<number, number | null>([
      [11, 200],
      [22, 404],
      [33, 429],
      [44, null],
    ]);
    const report = await healthCheckCampgrounds(campgrounds, {
      checkPage: async (url) => {
        const id = Number(url.split("/").pop());
        return statusById.get(id) ?? null;
      },
      delayMs: 0,
      sleep: async () => undefined,
    });
    expect(report).toEqual({
      checked: 4,
      alive: 1,
      dead: [22],
      unverified: [33, 44],
    });
  });

  it("checks every facility id exactly once", async () => {
    const campgrounds = [1, 2, 3].map(campgroundWithId);
    const visited: number[] = [];
    await healthCheckCampgrounds(campgrounds, {
      checkPage: async (url) => {
        visited.push(Number(url.split("/").pop()));
        return 200;
      },
      delayMs: 0,
      sleep: async () => undefined,
    });
    expect(visited).toEqual([1, 2, 3]);
  });

  it("spaces requests by the configured delay between items, not before the first", async () => {
    const campgrounds = [1, 2, 3].map(campgroundWithId);
    const sleeps: number[] = [];
    await healthCheckCampgrounds(campgrounds, {
      checkPage: async () => 200,
      delayMs: 1500,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(sleeps).toEqual([1500, 1500]);
  });

  it("returns an empty report for an empty catalog", async () => {
    const report = await healthCheckCampgrounds([], {
      checkPage: async () => 200,
      delayMs: 0,
      sleep: async () => undefined,
    });
    expect(report).toEqual({ checked: 0, alive: 0, dead: [], unverified: [] });
  });
});
