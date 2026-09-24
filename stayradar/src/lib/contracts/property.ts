import { z } from "zod";
import { isoDateSchema } from "./shared";

/**
 * Wire contracts for the property detail API (spec art_XasJ5Kw8, "API
 * routes": GET /api/properties/[id] — detail + availability calendar).
 */

export const PropertyDetailSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  market: z.string(),
  /** Connector that produced the row: "seed" | "ical" | "csv" (future feeds). */
  source: z.string(),
  /**
   * Free-form on the wire: the column is text and CSV imports may carry
   * values outside the search filter's cabin/condo/house enum.
   */
  propertyType: z.string(),
  address: z.string().nullable(),
  maxGuests: z.number().int().positive(),
  bedrooms: z.number().int().nonnegative(),
  amenities: z.array(z.string()),
  baseNightly: z.number().nonnegative(),
  images: z.array(z.string()),
  latitude: z.number(),
  longitude: z.number(),
});
export type PropertyDetail = z.infer<typeof PropertyDetailSchema>;

export const AvailabilityDaySchema = z.object({
  date: isoDateSchema,
  status: z.enum(["available", "booked", "blocked"]),
  /** Priced nights only; blocked nights carry no rate. */
  nightlyPrice: z.number().nullable(),
});
export type AvailabilityDay = z.infer<typeof AvailabilityDaySchema>;

export const AvailabilityCalendarSchema = z.object({
  propertyId: z.uuid(),
  /** Echo of the requested window; null fields mean "full calendar requested". */
  checkIn: isoDateSchema.nullable(),
  checkOut: isoDateSchema.nullable(),
  days: z.array(AvailabilityDaySchema),
});
export type AvailabilityCalendar = z.infer<typeof AvailabilityCalendarSchema>;

export const PropertyDetailResponseSchema = z.object({
  property: PropertyDetailSchema,
  availability: AvailabilityCalendarSchema,
});
export type PropertyDetailResponse = z.infer<typeof PropertyDetailResponseSchema>;

/**
 * Optional availability window for the detail route: supply both dates to
 * slice the calendar, or neither for the full calendar.
 */
export const AvailabilityWindowSchema = z
  .object({
    checkIn: isoDateSchema.optional(),
    checkOut: isoDateSchema.optional(),
  })
  .strict()
  .refine((w) => (w.checkIn !== undefined) === (w.checkOut !== undefined), {
    message: "provide both checkIn and checkOut (or neither)",
    path: ["checkOut"],
  })
  .refine((w) => !w.checkIn || !w.checkOut || w.checkOut > w.checkIn, {
    message: "checkOut must be after checkIn",
    path: ["checkOut"],
  });
export type AvailabilityWindow = z.infer<typeof AvailabilityWindowSchema>;
