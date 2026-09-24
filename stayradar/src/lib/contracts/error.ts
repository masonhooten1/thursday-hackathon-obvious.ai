import { z } from "zod";

/**
 * Wire contracts for the error envelope (spec art_XasJ5Kw8, "API routes").
 * Every non-2xx response from a StayRadar route uses this one shape, so the
 * frontend parses failures with a single schema and can branch on `code`.
 */

/** Machine-readable failure classes a client can branch on. */
export const ApiErrorCodeSchema = z.enum(["bad_request", "not_found", "internal_error"]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** A single field-level validation failure, e.g. { path: "latitude", message: "..." }. */
export const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    /** Present only when the failure has field-level detail (validation). */
    details: z.array(ValidationIssueSchema).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
