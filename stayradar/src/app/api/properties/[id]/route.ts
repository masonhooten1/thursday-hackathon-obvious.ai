import { NextResponse, type NextRequest } from "next/server";
import { getRequestDb } from "@/db/request-db";
import {
  PropertyLookupValidationError,
  getPropertyWithAvailability,
} from "@/lib/services/property-service";
import { errorResponse } from "../../http";

/** DB-backed per request — never prerendered at build time. */
export const dynamic = "force-dynamic";

/**
 * GET /api/properties/[id] — property detail + availability calendar
 * (spec art_XasJ5Kw8, "API routes"). Optional checkIn/checkOut window query
 * params slice the calendar; omitting them returns the full date-keyed
 * calendar. Unknown id → 404 envelope; malformed id or window → 400 with
 * field details.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const rawWindow: Record<string, string> = {};
    for (const key of ["checkIn", "checkOut"] as const) {
      const value = request.nextUrl.searchParams.get(key);
      if (value !== null) rawWindow[key] = value;
    }

    const detail = await getPropertyWithAvailability(getRequestDb(), id, rawWindow);
    if (!detail) {
      return errorResponse("not_found", `no property with id ${id}`);
    }
    return NextResponse.json(detail);
  } catch (error) {
    if (error instanceof PropertyLookupValidationError) {
      return errorResponse("bad_request", error.message, error.issues);
    }
    console.error("[api/properties] unexpected error", error);
    return errorResponse("internal_error", "Unexpected server error");
  }
}
