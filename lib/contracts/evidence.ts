import { z } from "zod";

/**
 * Frozen Evidence contract (spec §Frozen contracts, brief §Evidence and output
 * contracts). Every observation in an account plan must resolve to one of
 * these records. `capturedAt` is retained in all derived evidence.
 */
export const evidenceMethodSchema = z.enum([
  "html",
  "rendered_dom",
  "network",
  "first_party_text",
]);
export type EvidenceMethod = z.infer<typeof evidenceMethodSchema>;

export const evidenceSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  url: z.string().url(),
  capturedAt: z.string().datetime(),
  method: evidenceMethodSchema,
  locator: z.string().optional(),
  excerpt: z.string().min(1),
  // Private storage key, never a public URL.
  snapshotRef: z.string().optional(),
  // e.g. "blocked", "cached", "render required"
  limitations: z.array(z.string()),
});
export type Evidence = z.infer<typeof evidenceSchema>;
