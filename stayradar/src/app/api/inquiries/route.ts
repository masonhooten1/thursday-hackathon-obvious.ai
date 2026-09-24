import { NextResponse, type NextRequest } from "next/server";
import { getRequestDb } from "@/db/request-db";
import { LeadValidationError, createInquiry } from "@/lib/services/lead-service";
import { PropertyNotFoundError } from "@/lib/services/property-service";
import { errorResponse } from "../http";

/** DB-backed per request — never prerendered at build time. */
export const dynamic = "force-dynamic";

/**
 * POST /api/inquiries — inquiry capture (spec art_XasJ5Kw8, "API routes"):
 * validated JSON body → `leads` row, linked to the originating search event
 * when the client supplies its searchEventId. 201 with the persisted lead;
 * malformed body → 400 envelope; unknown property → 404.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "malformed JSON body");
  }

  try {
    const lead = await createInquiry(getRequestDb(), body);
    return NextResponse.json(lead, { status: 201 });
  } catch (error) {
    if (error instanceof LeadValidationError) {
      return errorResponse("bad_request", error.message, error.issues);
    }
    if (error instanceof PropertyNotFoundError) {
      return errorResponse("not_found", error.message);
    }
    console.error("[api/inquiries] unexpected error", error);
    return errorResponse("internal_error", "Unexpected server error");
  }
}
