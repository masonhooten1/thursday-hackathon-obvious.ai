import { sql } from "drizzle-orm";
import type { StayRadarDb } from "@/db";
import {
  PropertySearchQuerySchema,
  PropertySearchResponseSchema,
  type PropertySearchResponse,
} from "@/lib/contracts/search";

/**
 * Radius search service (spec art_XasJ5Kw8).
 *
 * The SQL is the product: ST_DWithin over the geography column with the GiST
 * index, spheroid meters, nearest-first ordering, and an availability-window
 * join. Framework-free — route handlers stay thin adapters over this module.
 */

const METERS_PER_MILE = 1609.34;

/**
 * Derive a short opaque session digest for the telemetry row. Not a user id:
 * callers pass a per-visit token (or none), and only this digest is stored —
 * no emails, no person-level location data.
 */
export function hashSessionToken(token: string): string {
  return Buffer.from(token).toString("base64").slice(0, 24);
}

// Type alias (not interface) so the shape satisfies drizzle's
// Record<string, unknown> row constraint via implicit index signature.
type RawSearchRow = {
  id: string;
  slug: string;
  title: string;
  market: string;
  property_type: string;
  latitude: number;
  longitude: number;
  distance_miles: number;
  min_nightly: number | null;
  available_for_window: boolean;
};

export class SearchValidationError extends Error {
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "SearchValidationError";
  }
}

/**
 * Run a radius search and record the first-party search event behind it.
 *
 * Window semantics (per spec): a booked/blocked NIGHT anywhere in
 * [checkIn, checkOut) disqualifies the property — the guest departs on the
 * checkout day, so that day's calendar status is irrelevant.
 *
 * Throws SearchValidationError for invalid input (routes map that to 400);
 * an empty result set is a valid, typed response.
 */
export async function searchProperties(
  db: StayRadarDb,
  rawQuery: unknown,
): Promise<PropertySearchResponse> {
  const parsed = PropertySearchQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    throw new SearchValidationError(
      "Invalid property search query",
      parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    );
  }
  const q = parsed.data;
  const meters = q.radiusMiles * METERS_PER_MILE;

  const result = await db.execute<RawSearchRow>(sql`
    SELECT
      p.id, p.slug, p.title, p.market, p.property_type,
      ST_Y(p.location::geometry) AS latitude,
      ST_X(p.location::geometry) AS longitude,
      ST_Distance(p.location, ST_MakePoint(${q.longitude}, ${q.latitude})::geography) / ${METERS_PER_MILE} AS distance_miles,
      COALESCE(MIN(a.nightly_price), p.base_nightly)::float8 AS min_nightly,
      NOT EXISTS (
        SELECT 1 FROM availability bad
        WHERE bad.property_id = p.id
          AND bad.date >= ${q.checkIn}
          AND bad.date < ${q.checkOut}
          AND bad.status <> 'available'
      ) AS available_for_window
    FROM properties p
    LEFT JOIN availability a
      ON a.property_id = p.id
      AND a.date >= ${q.checkIn}
      AND a.date < ${q.checkOut}
      AND a.status = 'available'
    WHERE ST_DWithin(
      p.location,
      ST_MakePoint(${q.longitude}, ${q.latitude})::geography,
      ${meters}
    )
    AND p.max_guests >= ${q.guests}
    AND (${q.propertyType ?? null}::text IS NULL OR p.property_type = ${q.propertyType ?? null}::text)
    -- Availability-window disqualification: a booked/blocked night inside the
    -- requested window removes the property from the result set entirely.
    AND NOT EXISTS (
      SELECT 1 FROM availability bad
      WHERE bad.property_id = p.id
        AND bad.date >= ${q.checkIn}
        AND bad.date < ${q.checkOut}
        AND bad.status <> 'available'
    )
    GROUP BY p.id
    ORDER BY distance_miles ASC
  `);

  const rows = result.rows;
  // Dominant market of the search = nearest hit's market; null when nothing
  // matched (still recorded — "searched, found nothing" is marketing signal).
  const dominantMarket = rows[0]?.market ?? null;
  const eventResult = await db.execute<{ id: string }>(sql`
    INSERT INTO search_events (session_hash, market, lat, lng, radius_miles, check_in, check_out, guests, utm)
    VALUES (
      ${q.sessionHash ?? hashSessionToken(`${q.latitude},${q.longitude}:${Date.now()}`)},
      ${dominantMarket}, ${q.latitude}, ${q.longitude}, ${Math.round(q.radiusMiles)},
      ${q.checkIn}, ${q.checkOut}, ${q.guests},
      ${q.utm ? JSON.stringify(q.utm) : null}::jsonb
    )
    RETURNING id
  `);
  const searchEventId = eventResult.rows[0].id;

  return PropertySearchResponseSchema.parse({
    searchEventId,
    total: rows.length,
    results: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      market: row.market,
      propertyType: row.property_type,
      latitude: row.latitude,
      longitude: row.longitude,
      distanceMiles: row.distance_miles,
      minNightly: row.min_nightly,
      availableForWindow: row.available_for_window,
    })),
  });
}
