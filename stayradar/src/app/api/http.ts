import { NextResponse } from "next/server";
import { ErrorResponseSchema, type ApiErrorCode, type ValidationIssue } from "@/lib/contracts/error";

/**
 * Shared response helpers for the StayRadar route handlers. Every failure
 * body is the ErrorResponseSchema envelope (spec art_XasJ5Kw8: zod contracts
 * are the single source of truth) — routes never hand-roll error shapes.
 * The default status follows the code; callers can override for the rare
 * case where a code and status diverge.
 */
export function errorResponse(
  code: ApiErrorCode,
  message: string,
  details: ValidationIssue[] = [],
  status?: number,
): NextResponse {
  const defaultStatus = code === "bad_request" ? 400 : code === "not_found" ? 404 : 500;
  const envelope = ErrorResponseSchema.parse({
    error: { code, message, ...(details.length > 0 ? { details } : {}) },
  });
  return NextResponse.json(envelope, { status: status ?? defaultStatus });
}
