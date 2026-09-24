import { z } from "zod";

/**
 * ISO calendar date (YYYY-MM-DD) — the wire format for every date field in
 * the StayRadar API. Availability is date-keyed in the schema, so query
 * strings, JSON bodies, and stored rows all speak this one format.
 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export type IsoDate = z.infer<typeof isoDateSchema>;
