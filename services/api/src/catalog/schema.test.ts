import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../db";
import { createCatalogSchema, insertCatalog, listCampgrounds, listParks } from "./schema";
import type { Campground, Park } from "@campground/shared";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "catalog-schema-"));
  return openDb(join(dir, "catalog.db"));
}

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

describe("createCatalogSchema", () => {
  it("creates tables idempotently", () => {
    const db = tempDb();
    try {
      createCatalogSchema(db);
      createCatalogSchema(db);
      expect(listParks(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects campgrounds whose park does not exist (FK enforcement)", () => {
    const db = tempDb();
    try {
      createCatalogSchema(db);
      expect(() => insertCatalog(db, [], [campground])).toThrow(/FOREIGN KEY/);
    } finally {
      db.close();
    }
  });
});

describe("insertCatalog + readers", () => {
  it("round-trips parks and campgrounds", () => {
    const db = tempDb();
    try {
      createCatalogSchema(db);
      insertCatalog(db, [park], [campground]);
      expect(listParks(db)).toEqual([park]);
      expect(listCampgrounds(db)).toEqual([campground]);
    } finally {
      db.close();
    }
  });

  it("replaces the whole catalog atomically on re-seed", () => {
    const db = tempDb();
    try {
      createCatalogSchema(db);
      insertCatalog(db, [park], [campground]);
      const updated: Campground = { ...campground, name: "Watchman Campground (UT)" };
      insertCatalog(db, [park], [updated]);
      expect(listCampgrounds(db)).toEqual([updated]);
    } finally {
      db.close();
    }
  });
});
