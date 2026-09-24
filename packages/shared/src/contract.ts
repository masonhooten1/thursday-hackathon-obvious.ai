import { z } from "zod";

/**
 * The Campground Tonight wire contract — the single source of truth shared by
 * the API (services/api) and the app (apps/mobile). Shapes mirror the MVP spec
 * (blueprint art_VwFCEgL3); types are inferred from the zod schemas so the
 * wire format cannot drift between packages.
 */

/** Normalized site categories. RIDB attributes map onto these; anything unrecognized becomes "other". */
export const SITE_TYPES = ["tent", "rv", "cabin", "group", "other"] as const;
export const SiteTypeSchema = z.enum(SITE_TYPES);
export type SiteType = z.infer<typeof SiteTypeSchema>;

export const ParkSchema = z.object({
  /** Slug, e.g. "yosemite". */
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
});
export type Park = z.infer<typeof ParkSchema>;

export const CampgroundSchema = z.object({
  /** Recreation.gov facility id. */
  facilityId: z.number().int().positive(),
  /** FK -> Park.id */
  parkId: z.string().min(1),
  name: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  /** Official reservation page: https://www.recreation.gov/camping/campgrounds/{facilityId} */
  bookingUrl: z.string().url(),
  /** Normalized from RIDB attributes. */
  siteTypes: z.array(SiteTypeSchema),
});
export type Campground = z.infer<typeof CampgroundSchema>;

export const AvailabilitySnapshotSchema = z.object({
  facilityId: z.number().int().positive(),
  /** ISO timestamp of this poll cycle. */
  capturedAt: z.iso.datetime(),
  /** ISO date (YYYY-MM-DD) of the first night. */
  windowStart: z.iso.date(),
  /** Nights covered by the window; default 14. */
  nights: z.number().int().positive(),
  /** Available sites per night per type; index 0 = windowStart. */
  byType: z.record(SiteTypeSchema, z.array(z.number().int().min(0))),
  totalSites: z.number().int().nonnegative(),
})
  // Every type array must cover the full window — one entry per night.
  .refine((snapshot) => SITE_TYPES.every((type) => snapshot.byType[type].length === snapshot.nights), {
    message: "each byType array must have exactly `nights` entries",
  });
export type AvailabilitySnapshot = z.infer<typeof AvailabilitySnapshotSchema>;

export const AvailabilityResponseSchema = z.object({
  /** Requested night, YYYY-MM-DD. */
  date: z.iso.date(),
  fetchedAt: z.iso.datetime(),
  /** True when the snapshot is older than twice the poll interval. */
  stale: z.boolean(),
  campgrounds: z.array(CampgroundSchema.extend({ snapshot: AvailabilitySnapshotSchema.nullable() })),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;

/** Poll cadence in minutes (spec: availability refreshes every 15 minutes). */
export const POLL_INTERVAL_MINUTES = 15;
/** The API flags a snapshot stale past this multiple of the poll interval. */
export const STALE_AFTER_MULTIPLE = 2;
