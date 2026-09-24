import { and, asc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import type { StayRadarDb } from "@/db";
import { availability, properties, type PropertyRow } from "@/db/schema";
import type { ValidationIssue } from "@/lib/contracts/error";
import {
  AvailabilityWindowSchema,
  PropertyDetailResponseSchema,
  PropertyDetailSchema,
  type PropertyDetail,
  type PropertyDetailResponse,
} from "@/lib/contracts/property";

/**
 * Property detail service (spec art_XasJ5Kw8, "API routes": property detail +
 * availability calendar). Framework-free — the route handler stays a thin
 * adapter that maps these errors onto status codes.
 */

const PropertyIdSchema = z.uuid();

export class PropertyLookupValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[],
  ) {
    super(message);
    this.name = "PropertyLookupValidationError";
  }
}

/** Referenced property does not exist — routes map this to 404. */
export class PropertyNotFoundError extends Error {
  constructor(readonly propertyId: string) {
    super(`no property with id ${propertyId}`);
    this.name = "PropertyNotFoundError";
  }
}

function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/** The id is validated as a bare value, so its issues carry an empty path — relabel them for the API consumer. */
function idValidationIssues(error: z.ZodError): ValidationIssue[] {
  return toValidationIssues(error).map((issue) => ({ ...issue, path: "id" }));
}

/** Map a properties row onto the wire detail contract. */
function toPropertyDetail(row: PropertyRow): PropertyDetail {
  return PropertyDetailSchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    market: row.market,
    source: row.source,
    propertyType: row.propertyType,
    address: row.address,
    maxGuests: row.maxGuests,
    bedrooms: row.bedrooms,
    amenities: row.amenities,
    baseNightly: row.baseNightly,
    images: row.images,
    latitude: row.location.latitude,
    longitude: row.location.longitude,
  });
}

/**
 * Property detail plus availability calendar. The window is optional: pass
 * both dates to slice the calendar, or neither for the full date-keyed
 * calendar ordered oldest-first. Returns null when the id is unknown
 * (routes map that to 404); throws PropertyLookupValidationError when the
 * id or window is malformed (routes map that to 400 with field details).
 */
export async function getPropertyWithAvailability(
  db: StayRadarDb,
  rawId: string,
  rawWindow: unknown = {},
): Promise<PropertyDetailResponse | null> {
  const idParsed = PropertyIdSchema.safeParse(rawId);
  const windowParsed = AvailabilityWindowSchema.safeParse(rawWindow);
  if (!idParsed.success || !windowParsed.success) {
    throw new PropertyLookupValidationError(
      "Invalid property lookup",
      [
        ...(idParsed.success ? [] : idValidationIssues(idParsed.error)),
        ...(windowParsed.success ? [] : toValidationIssues(windowParsed.error)),
      ],
    );
  }
  const id: string = idParsed.data;
  const window = windowParsed.data;

  const propertyRows = await db.select().from(properties).where(eq(properties.id, id)).limit(1);
  const property = propertyRows[0];
  if (!property) return null;

  const filters = [eq(availability.propertyId, id)];
  if (window.checkIn) filters.push(gte(availability.date, window.checkIn));
  if (window.checkOut) filters.push(lte(availability.date, window.checkOut));
  const nights = await db
    .select({
      date: availability.date,
      status: availability.status,
      nightlyPrice: availability.nightlyPrice,
    })
    .from(availability)
    .where(and(...filters))
    .orderBy(asc(availability.date));

  return PropertyDetailResponseSchema.parse({
    property: toPropertyDetail(property),
    availability: {
      propertyId: id,
      checkIn: window.checkIn ?? null,
      checkOut: window.checkOut ?? null,
      days: nights,
    },
  });
}
