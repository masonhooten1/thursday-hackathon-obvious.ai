import { eq } from "drizzle-orm";
import { z } from "zod";
import type { StayRadarDb } from "@/db";
import { leads, properties, searchEvents } from "@/db/schema";
import type { ValidationIssue } from "@/lib/contracts/error";
import { InquiryRequestSchema, InquiryResponseSchema, type InquiryResponse } from "@/lib/contracts/lead";
import { PropertyNotFoundError } from "./property-service";

/**
 * Inquiry capture service (spec art_XasJ5Kw8, "API routes": POST leads →
 * `leads` row linked to the originating search event). Framework-free — the
 * route handler stays a thin adapter that maps these errors onto status
 * codes.
 */

export class LeadValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[],
  ) {
    super(message);
    this.name = "LeadValidationError";
  }
}

function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

/**
 * Validate and persist an inquiry. Referenced entities are checked before
 * insert so failures surface as typed errors, not raw FK violations:
 * unknown property → PropertyNotFoundError (404); unknown search event →
 * LeadValidationError with a field detail (400).
 */
export async function createInquiry(db: StayRadarDb, raw: unknown): Promise<InquiryResponse> {
  const parsed = InquiryRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LeadValidationError("Invalid inquiry", toValidationIssues(parsed.error));
  }
  const input = parsed.data;

  const propertyRows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, input.propertyId))
    .limit(1);
  if (!propertyRows[0]) {
    throw new PropertyNotFoundError(input.propertyId);
  }

  if (input.searchEventId) {
    const eventRows = await db
      .select({ id: searchEvents.id })
      .from(searchEvents)
      .where(eq(searchEvents.id, input.searchEventId))
      .limit(1);
    if (!eventRows[0]) {
      throw new LeadValidationError("Invalid inquiry", [
        { path: "searchEventId", message: "unknown search event" },
      ]);
    }
  }

  const [row] = await db
    .insert(leads)
    .values({
      propertyId: input.propertyId,
      searchEventId: input.searchEventId ?? null,
      checkIn: input.checkIn ?? null,
      checkOut: input.checkOut ?? null,
      guests: input.guests ?? null,
      name: input.name,
      email: input.email,
      message: input.message ?? null,
    })
    .returning({ id: leads.id, createdAt: leads.createdAt });

  return InquiryResponseSchema.parse({
    id: row.id,
    propertyId: input.propertyId,
    searchEventId: input.searchEventId ?? null,
    status: "received",
    createdAt: row.createdAt.toISOString(),
  });
}
