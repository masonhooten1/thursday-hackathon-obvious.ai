import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AvailabilitySnapshot, Campground, Park } from "@campground/shared";
import { createCatalogSchema, insertCatalog } from "../catalog/schema";
import { openDb } from "../db";
import { createSnapshotsSchema, insertSnapshot, latestSnapshot, pruneSnapshots } from "./store";

const PARK: Park = { id: "zion", name: "Zion National Park", state: "Utah", lat: 37.3, lng: -113.03 };

const campground = (facilityId: number): Campground => ({
  facilityId,
  parkId: "zion",
  name: `Campground ${facilityId}`,
  lat: 37.2,
  lng: -112.98,
  bookingUrl: `https://www.recreation.gov/camping/campgrounds/${facilityId}`,
  siteTypes: ["tent"],
});

function fakeSnapshot(facilityId: number, capturedAt: Date, totalSites = 5): AvailabilitySnapshot {
  const nights = 14;
  return {
    facilityId,
    capturedAt: capturedAt.toISOString(),
    windowStart: capturedAt.toISOString().slice(0, 10),
    nights,
    byType: {
      tent: Array.from({ length: nights }, () => 2),
      rv: Array.from({ length: nights }, () => 1),
      cabin: Array.from({ length: nights }, () => 0),
      group: Array.from({ length: nights }, () => 0),
      other: Array.from({ length: nights }, () => 0),
    },
    totalSites,
  };
}

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "snapshot-store-"));
  const db = openDb(join(dir, "test.db"));
  createCatalogSchema(db);
  createSnapshotsSchema(db);
  // Snapshots carry a foreign key into the catalog — seed facility 101 so
  // insert-level tests have a referencable campground.
  insertCatalog(db, [PARK], [campground(101)]);
  return db;
}

describe("createSnapshotsSchema", () => {
  it("creates the tables idempotently", () => {
    const db = tempDb();
    try {
      createSnapshotsSchema(db);
      expect(latestSnapshot(db, 101)).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("insertSnapshot + latestSnapshot", () => {
  it("round-trips the full snapshot payload", () => {
    const db = tempDb();
    try {
      const snapshot = fakeSnapshot(101, new Date("2026-09-24T19:45:02.000Z"));
      insertSnapshot(db, snapshot);
      expect(latestSnapshot(db, 101)).toEqual(snapshot);
    } finally {
      db.close();
    }
  });

  it("serves the most recent capturedAt, not the most recent insert", () => {
    const db = tempDb();
    try {
      insertSnapshot(db, fakeSnapshot(101, new Date("2026-09-24T20:00:00.000Z")));
      insertSnapshot(db, fakeSnapshot(101, new Date("2026-09-24T19:45:00.000Z")));
      expect(latestSnapshot(db, 101)?.capturedAt).toBe("2026-09-24T20:00:00.000Z");
    } finally {
      db.close();
    }
  });

  it("rewrites, never duplicates, an identical (facility, capturedAt) pair", () => {
    const db = tempDb();
    try {
      const capturedAt = new Date("2026-09-24T19:45:02.000Z");
      insertSnapshot(db, fakeSnapshot(101, capturedAt, 5));
      insertSnapshot(db, fakeSnapshot(101, capturedAt, 7));
      const rows = db.prepare("SELECT COUNT(*) AS n FROM snapshots").get() as { n: number };
      expect(rows.n).toBe(1);
      expect(latestSnapshot(db, 101)?.totalSites).toBe(7);
    } finally {
      db.close();
    }
  });

  it("rejects a payload that breaks the shared contract", () => {
    const db = tempDb();
    try {
      const broken = fakeSnapshot(101, new Date("2026-09-24T19:45:02.000Z"));
      broken.byType.tent = [1, 2, 3]; // wrong length for `nights`
      expect(() => insertSnapshot(db, broken)).toThrow();
    } finally {
      db.close();
    }
  });
});

describe("pruneSnapshots", () => {
  it("deletes only rows captured strictly before the cutoff", () => {
    const db = tempDb();
    try {
      insertCatalog(db, [PARK], [campground(101)]);
      const cutoff = new Date("2026-09-24T00:00:00.000Z");
      insertSnapshot(db, fakeSnapshot(101, new Date("2026-09-23T23:59:59.999Z"))); // 1 ms before
      insertSnapshot(db, fakeSnapshot(101, new Date("2026-09-24T00:00:00.000Z"))); // exactly at
      insertSnapshot(db, fakeSnapshot(101, new Date("2026-09-25T00:00:00.000Z"))); // after
      expect(pruneSnapshots(db, cutoff)).toBe(1);
      expect(latestSnapshot(db, 101)?.capturedAt).toBe("2026-09-25T00:00:00.000Z");
    } finally {
      db.close();
    }
  });
});

describe("catalog cascade", () => {
  it("removes a campground's snapshots when the campground row is deleted", () => {
    const db = tempDb();
    try {
      insertCatalog(db, [PARK], [campground(101)]);
      insertSnapshot(db, fakeSnapshot(101, new Date("2026-09-24T19:45:02.000Z")));
      db.prepare("DELETE FROM campgrounds WHERE facility_id = ?").run(101);
      expect(latestSnapshot(db, 101)).toBeNull();
    } finally {
      db.close();
    }
  });
});
