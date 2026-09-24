import { z } from "zod";
import { isoDateSchema } from "./shared";

/**
 * Wire contracts for the radius search API (spec art_XasJ5Kw8, "Radius
 * search — the query the whole product stands on"). Zod is the boundary:
 * invalid queries are rejected here, before any SQL runs.
 */

export const PropertyTypeSchema = z.enum(["cabin", "condo", "house"]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

/**
 * The query contract accepts both wire forms: query-string parameters arrive
 * as strings (GET /api/search) and JSON calls send numbers — coerce.number()
 * normalizes both before the bounds are checked.
 */
export const PropertySearchQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    /** Radius in miles; the spec enforces radius > 0 (defaults to the 25 mi campaign default). */
    radiusMiles: z.coerce.number().positive().max(500).default(25),
    checkIn: isoDateSchema,
    checkOut: isoDateSchema,
    guests: z.coerce.number().int().positive().max(50).default(2),
    propertyType: PropertyTypeSchema.optional(),
    /** Anonymous per-session hash (rotating); never a stable user id. */
    sessionHash: z.string().min(8).max(128).optional(),
    /** Origin-market signal captured from the landing URL, e.g. utm_source. */
    utm: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine((q) => q.checkOut > q.checkIn, {
    message: "checkOut must be after checkIn",
    path: ["checkOut"],
  });

export type PropertySearchQuery = z.infer<typeof PropertySearchQuerySchema>;

export const PropertySearchResultSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  market: z.string(),
  propertyType: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  distanceMiles: z.number(),
  /** Cheapest available night inside the window; falls back to baseNightly. */
  minNightly: z.number(),
  availableForWindow: z.boolean(),
});
export type PropertySearchResult = z.infer<typeof PropertySearchResultSchema>;

export const PropertySearchResponseSchema = z.object({
  searchEventId: z.uuid(),
  results: z.array(PropertySearchResultSchema),
  total: z.number().int().nonnegative(),
});
export type PropertySearchResponse = z.infer<typeof PropertySearchResponseSchema>;
