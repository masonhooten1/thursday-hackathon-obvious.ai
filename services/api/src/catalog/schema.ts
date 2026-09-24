import type { Campground, Park } from "@campground/shared";
import type { Db } from "../db";

/**
 * Catalog tables backing the curated seed. Created idempotently so the
 * seeder can run against a fresh or existing database.
 */
export function createCatalogSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS parks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campgrounds (
      facility_id INTEGER PRIMARY KEY,
      park_id TEXT NOT NULL REFERENCES parks(id),
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      booking_url TEXT NOT NULL,
      site_types TEXT NOT NULL
    );
  `);
}

export function insertCatalog(db: Db, parks: Park[], campgrounds: Campground[]): void {
  const insertPark = db.prepare(
    "INSERT INTO parks (id, name, state, lat, lng) VALUES (?, ?, ?, ?, ?)",
  );
  const insertCampground = db.prepare(
    "INSERT INTO campgrounds (facility_id, park_id, name, lat, lng, booking_url, site_types) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  // One transaction: a half-seeded catalog is worse than none.
  db.transaction(() => {
    // Replace, not upsert — the seed files are the whole catalog.
    db.prepare("DELETE FROM campgrounds").run();
    db.prepare("DELETE FROM parks").run();
    for (const park of parks) {
      insertPark.run(park.id, park.name, park.state, park.lat, park.lng);
    }
    for (const campground of campgrounds) {
      insertCampground.run(
        campground.facilityId,
        campground.parkId,
        campground.name,
        campground.lat,
        campground.lng,
        campground.bookingUrl,
        JSON.stringify(campground.siteTypes),
      );
    }
  })();
}

export function listParks(db: Db): Park[] {
  return db.prepare("SELECT id, name, state, lat, lng FROM parks ORDER BY id").all() as Park[];
}

export function listCampgrounds(db: Db): Campground[] {
  const rows = db
    .prepare(
      "SELECT facility_id, park_id, name, lat, lng, booking_url, site_types FROM campgrounds ORDER BY park_id, facility_id",
    )
    .all() as Array<{
    facility_id: number;
    park_id: string;
    name: string;
    lat: number;
    lng: number;
    booking_url: string;
    site_types: string;
  }>;
  return rows.map((row) => ({
    facilityId: row.facility_id,
    parkId: row.park_id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    bookingUrl: row.booking_url,
    siteTypes: JSON.parse(row.site_types) as Campground["siteTypes"],
  }));
}
