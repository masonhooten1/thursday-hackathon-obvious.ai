import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITE_TYPES } from "@campground/shared";
import type { SiteType } from "@campground/shared";
import { findSeedIssues, parseCampgroundsSeed, parseParksSeed } from "./seed";

/**
 * These tests assert the properties the MVP spec sets on the committed catalog:
 * shape (via the shared contract), referential integrity, bookingUrl pattern,
 * and count thresholds (>= 60 campgrounds across >= 6 parks). They read the
 * seed files that ship with the repo, so any curation edit that breaks the
 * contract or the thresholds fails CI before the seeder ever runs.
 */
const SEED_DIR = fileURLToPath(new URL("../../seed/", import.meta.url));

const parksSeed = parseParksSeed(readFileSync(join(SEED_DIR, "parks.json"), "utf8"));
const campgroundsSeed = parseCampgroundsSeed(
  readFileSync(join(SEED_DIR, "campgrounds.json"), "utf8"),
);

const parks = parksSeed.parks;
const campgrounds = campgroundsSeed.campgrounds;

describe("committed campground seed data", () => {
  it("carries a version-1 envelope with a real generation timestamp", () => {
    expect(parksSeed.version).toBe(1);
    expect(campgroundsSeed.version).toBe(1);
    expect(parksSeed.generatedAt).toBe(campgroundsSeed.generatedAt);
    expect(Number.isNaN(Date.parse(parksSeed.generatedAt))).toBe(false);
  });

  it("meets the spec thresholds: 60+ campgrounds across 6 parks", () => {
    expect(parks).toHaveLength(6);
    expect(campgrounds.length).toBeGreaterThanOrEqual(60);
    const referencedParks = new Set(campgrounds.map((c) => c.parkId));
    expect(referencedParks.size).toBeGreaterThanOrEqual(6);
  });

  it("contains exactly the six marquee parks with complete metadata", () => {
    expect(new Set(parks.map((p) => p.id))).toEqual(
      new Set(["yosemite", "yellowstone", "grand-canyon", "zion", "great-smoky-mountains", "glacier"]),
    );
    for (const park of parks) {
      expect(park.name).toMatch(/National Park$/);
      expect(park.state).not.toBe("");
      expect(park.lat).toBeGreaterThan(0);
      expect(park.lng).toBeLessThan(0);
    }
  });

  it("passes referential integrity and id uniqueness", () => {
    expect(findSeedIssues(parks, campgrounds)).toEqual([]);
  });

  it("builds every bookingUrl from its own facility id", () => {
    for (const campground of campgrounds) {
      expect(campground.bookingUrl).toBe(
        `https://www.recreation.gov/camping/campgrounds/${campground.facilityId}`,
      );
      expect(campground.bookingUrl).toMatch(
        /^https:\/\/www\.recreation\.gov\/camping\/campgrounds\/\d+$/,
      );
    }
  });

  it("normalizes site types to the contract order, non-empty", () => {
    for (const campground of campgrounds) {
      expect(campground.siteTypes.length).toBeGreaterThan(0);
      expect(new Set(campground.siteTypes).size).toBe(campground.siteTypes.length);
      expect(campground.siteTypes).toEqual(SITE_TYPES.filter((t) => campground.siteTypes.includes(t)));
      expect(campground.siteTypes.every((t) => (SITE_TYPES as readonly SiteType[]).includes(t))).toBe(true);
    }
  });

  it("keeps coordinates inside plausible CONUS bounds", () => {
    for (const campground of campgrounds) {
      expect(campground.lat).toBeGreaterThan(24);
      expect(campground.lat).toBeLessThan(50);
      expect(campground.lng).toBeGreaterThan(-135);
      expect(campground.lng).toBeLessThan(-60);
    }
  });

  it("never reuses a display name within a park", () => {
    const byPark = new Map<string, Set<string>>();
    for (const campground of campgrounds) {
      const names = byPark.get(campground.parkId) ?? new Set<string>();
      expect(names.has(campground.name)).toBe(false);
      names.add(campground.name);
      byPark.set(campground.parkId, names);
    }
  });

  it("every park hosts at least two campgrounds", () => {
    const counts = new Map<string, number>();
    for (const campground of campgrounds) {
      counts.set(campground.parkId, (counts.get(campground.parkId) ?? 0) + 1);
    }
    for (const park of parks) {
      expect(counts.get(park.id)).toBeGreaterThanOrEqual(2);
    }
  });
});
