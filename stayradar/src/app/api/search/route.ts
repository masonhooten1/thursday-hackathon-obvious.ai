import { NextResponse, type NextRequest } from "next/server";
import { getRequestDb } from "@/db/request-db";
import { SearchValidationError, searchProperties } from "@/lib/services/search-service";
import { errorResponse } from "../http";

/** DB-backed per request — never prerendered at build time. */
export const dynamic = "force-dynamic";

/** Query-string keys the search contract accepts; unknown params are ignored. */
const SEARCH_QUERY_KEYS = [
  "latitude",
  "longitude",
  "radiusMiles",
  "checkIn",
  "checkOut",
  "guests",
  "propertyType",
  "sessionHash",
] as const;

/**
 * Flatten the URLSearchParams surface into the plain object the search
 * contract validates. utm_* params ride along as the origin-market signal
 * (spec: the personalization input), preserving their full utm_ prefix.
 */
function collectSearchParams(params: URLSearchParams): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of SEARCH_QUERY_KEYS) {
    const value = params.get(key);
    if (value !== null) raw[key] = value;
  }
  const utm: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key.startsWith("utm_")) utm[key] = value;
  }
  if (Object.keys(utm).length > 0) raw.utm = utm;
  return raw;
}

/**
 * GET /api/search — radius search (spec art_XasJ5Kw8, "API routes").
 * Query params → searchService (validation + SQL + search event) → results
 * with distances and the persisted searchEventId.
 */
export async function GET(request: NextRequest) {
  try {
    const response = await searchProperties(
      getRequestDb(),
      collectSearchParams(request.nextUrl.searchParams),
    );
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof SearchValidationError) {
      return errorResponse("bad_request", error.message, error.issues);
    }
    console.error("[api/search] unexpected error", error);
    return errorResponse("internal_error", "Unexpected server error");
  }
}
