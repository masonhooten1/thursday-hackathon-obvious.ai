import { sql } from "drizzle-orm";
import {
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { geoPointToEwkt, parsePointEwkb, type GeoPoint } from "./geo";

/**
 * StayRadar data model (spec art_XasJ5Kw8, "Data model").
 *
 * PostGIS carries the geo semantics: geography(Point, 4326) with a GiST index
 * makes ST_DWithin radius search a native, index-backed operation rather than
 * an application-level Haversine loop. Availability is date-keyed so iCal
 * syncs are idempotent upserts.
 */

/**
 * drizzle-orm 0.45 has no built-in `geography` column type (only `geometry`).
 * The spec requires geography — the spheroid, meter-based type the radius
 * search is built on — so it is defined here as a customType. JavaScript-side
 * the column reads/writes { latitude, longitude }; SQL-side it is
 * geography(Point, 4326).
 */
const geography = customType<{
  data: GeoPoint;
  driverData: string;
  config: { srid: number; type: "point" };
}>({
  dataType(config) {
    // The only constructed shape is the spec's geography(Point, 4326);
    // the fallback covers drizzle's undefined-config builder path.
    const { srid = 4326, type = "point" } = config ?? {};
    return `geography(${type}, ${srid})`;
  },
  toDriver(point) {
    return geoPointToEwkt(point);
  },
  fromDriver(wkbHex) {
    return parsePointEwkb(wkbHex);
  },
});

export type AvailabilityStatus = "available" | "booked" | "blocked";
export type CampaignStatus = "draft" | "generated" | "exported";

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    /** Market id, e.g. "lake-tahoe" | "gatlinburg" | "austin" | "cape-cod". */
    market: text("market").notNull(),
    /** Connector that produced the row: "seed" | "ical" | "csv" (future PMS feeds). */
    source: text("source").notNull(),
    externalId: text("external_id"),
    location: geography("location", { srid: 4326, type: "point" }).notNull(),
    address: text("address"),
    /** cabin | condo | house — the filter surface the spec's search exposes. */
    propertyType: text("property_type").notNull(),
    maxGuests: integer("max_guests").notNull(),
    bedrooms: integer("bedrooms").notNull(),
    amenities: jsonb("amenities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    baseNightly: numeric("base_nightly", { mode: "number" }).notNull(),
    images: jsonb("images").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    index("properties_location_gix").using("gist", t.location),
    uniqueIndex("properties_source_external_uq").on(t.source, t.externalId),
  ],
);

export const availability = pgTable(
  "availability",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: text("status", { enum: ["available", "booked", "blocked"] }).notNull(),
    nightlyPrice: numeric("nightly_price", { mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.date] })],
);

/**
 * First-party search telemetry — the marketing engine's raw material.
 * Only a rotating per-session hash is stored; no person-level location data.
 */
export const searchEvents = pgTable("search_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionHash: text("session_hash").notNull(),
  /** Dominant market of the result set (nearest property's market), if any. */
  market: text("market"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  radiusMiles: integer("radius_miles"),
  checkIn: date("check_in"),
  checkOut: date("check_out"),
  guests: integer("guests"),
  filters: jsonb("filters").$type<Record<string, unknown>>(),
  /** Origin-market signal (utm_source/utm_campaign) for personalization. */
  utm: jsonb("utm").$type<Record<string, string>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  /** Traceability back to the search that produced the inquiry. */
  searchEventId: uuid("search_event_id").references(() => searchEvents.id, {
    onDelete: "set null",
  }),
  checkIn: date("check_in"),
  checkOut: date("check_out"),
  guests: integer("guests"),
  name: text("name").notNull(),
  email: text("email").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Campaign configuration per market cluster. `config` holds the zod-validated
 * Google Ads–shaped payload (validation lands with the marketing task);
 * radiusMeters mirrors Google's ProximityInfo radius floor of 1 km.
 */
export const campaigns = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  market: text("market").notNull(),
  radiusMeters: integer("radius_meters").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  status: text("status", { enum: ["draft", "generated", "exported"] })
    .notNull()
    .default("draft"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PropertyRow = typeof properties.$inferSelect;
export type AvailabilityRow = typeof availability.$inferSelect;
export type SearchEventRow = typeof searchEvents.$inferSelect;
export type LeadRow = typeof leads.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
