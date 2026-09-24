import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Campground, Park } from "@campground/shared";
import { openDb } from "../db";
import { createCatalogSchema, listCampgrounds, listParks } from "./schema";
import { findSeedIssues, parseParksSeed, runSeeder } from "./seed";

const SEED_DIR = fileURLToPath(new URL("../../seed/", import.meta.url));

const park: Park = { id: "zion", name: "Zion National Park", state: "Utah", lat: 37.3, lng: -113.03 };
const campground: Campground = {
  facilityId: 232445,
  parkId: "zion",
  name: "Watchman Campground",
  lat: 37.198611,
  lng: -112.98638,
  bookingUrl: "https://www.recreation.gov/camping/campgrounds/232445",
  siteTypes: ["tent", "rv"],
};

describe("findSeedIssues", () => {
  it("accepts consistent seeds", () => {
    expect(findSeedIssues([park], [campground])).toEqual([]);
  });

  it("flags campgrounds that reference an unknown park", () => {
    const orphan: Campground = { ...campground, parkId: "shenandoah" };
    expect(findSeedIssues([park], [orphan])).toEqual([
      {
        kind: "unknown-park",
        message: "campground 232445 references unknown parkId: shenandoah",
      },
    ]);
  });

  it("flags duplicate facility ids and duplicate park ids", () => {
    const otherCampground: Campground = { ...campground, parkId: "zion" };
    expect(findSeedIssues([park, park], [campground, otherCampground])).toEqual([
      { kind: "duplicate-park", message: "duplicate park id: zion" },
      { kind: "duplicate-facility", message: "duplicate facility id: 232445" },
    ]);
  });
});

describe("seed file parsing", () => {
  it("rejects malformed JSON", () => {
    expect(() => parseParksSeed("{not json")).toThrow();
  });

  it("rejects seed files whose campground rows break the shared contract", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-seed-"));
    writeFileSync(
      join(dir, "parks.json"),
      JSON.stringify({ version: 1, generatedAt: "2026-09-24T20:00:00Z", parks: [park] }),
    );
    writeFileSync(
      join(dir, "campgrounds.json"),
      JSON.stringify({
        version: 1,
        generatedAt: "2026-09-24T20:00:00Z",
        campgrounds: [{ ...campground, siteTypes: ["yurt"] }],
      }),
    );
    const db = openDb(join(dir, "catalog.db"));
    try {
      await expect(runSeeder(db, dir, { healthCheck: false })).rejects.toThrow(/siteTypes/);
    } finally {
      db.close();
    }
  });

  it("rejects seeds that fail referential integrity before touching the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-seed-"));
    writeFileSync(
      join(dir, "parks.json"),
      JSON.stringify({ version: 1, generatedAt: "2026-09-24T20:00:00Z", parks: [park] }),
    );
    writeFileSync(
      join(dir, "campgrounds.json"),
      JSON.stringify({
        version: 1,
        generatedAt: "2026-09-24T20:00:00Z",
        campgrounds: [{ ...campground, parkId: "shenandoah" }],
      }),
    );
    const db = openDb(join(dir, "catalog.db"));
    try {
      createCatalogSchema(db);
      await expect(runSeeder(db, dir, { healthCheck: false })).rejects.toThrow(/referential integrity/);
      expect(listParks(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("runSeeder against the committed seed files", () => {
  it("loads all rows and health-checks every facility id without dead ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-seed-"));
    const db = openDb(join(dir, "catalog.db"));
    try {
      const report = await runSeeder(db, SEED_DIR, {
        healthCheck: true,
        healthDeps: {
          checkPage: async () => 200,
          delayMs: 0,
          sleep: async () => undefined,
        },
      });
      expect(report.parks).toBe(6);
      expect(report.campgrounds).toBeGreaterThanOrEqual(60);
      expect(report.health?.checked).toBe(report.campgrounds);
      expect(report.health?.dead).toEqual([]);
      expect(listParks(db)).toHaveLength(6);
      expect(listCampgrounds(db)).toHaveLength(report.campgrounds);
    } finally {
      db.close();
    }
  });

  it("flags dead ids in the report instead of failing the seed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-seed-"));
    const db = openDb(join(dir, "catalog.db"));
    try {
      const deadId = 258825; // Desert View — a real committed facility id
      const report = await runSeeder(db, SEED_DIR, {
        healthCheck: true,
        healthDeps: {
          checkPage: async (url) => (url.endsWith(String(deadId)) ? 404 : 200),
          delayMs: 0,
          sleep: async () => undefined,
        },
      });
      expect(report.health?.dead).toEqual([deadId]);
      // a flagged id is data about decay, not a seed error — rows all load
      expect(listCampgrounds(db)).toHaveLength(report.campgrounds);
    } finally {
      db.close();
    }
  });

  it("treats non-404 failures as unverified, not dead", async () => {
    const dir = mkdtempSync(join(tmpdir(), "catalog-seed-"));
    const db = openDb(join(dir, "catalog.db"));
    try {
      const report = await runSeeder(db, SEED_DIR, {
        healthCheck: true,
        healthDeps: {
          checkPage: async () => null, // simulate a network outage
          delayMs: 0,
          sleep: async () => undefined,
        },
      });
      expect(report.health?.dead).toEqual([]);
      expect(report.health?.unverified).toHaveLength(report.campgrounds);
    } finally {
      db.close();
    }
  });

  it("the committed seed files parse against the shared contract", () => {
    expect(() => parseParksSeed(readFileSync(join(SEED_DIR, "parks.json"), "utf8"))).not.toThrow();
  });
});
