import { z } from "zod";

/**
 * Frozen Finding contract (spec §Frozen contracts, brief §Evidence and output
 * contracts). An empty evidenceIds array means the reviewer rejected the
 * finding. Recommendations are always labeled "proposed"; metrics record the
 * baseline first — no invented lift.
 */
export const findingCategorySchema = z.enum([
  "positioning",
  "acquisition",
  "conversion",
  "nurture",
  "handoff",
  "measurement",
]);
export type FindingCategory = z.infer<typeof findingCategorySchema>;

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const effortSchema = z.enum(["small", "medium", "large"]);
export type Effort = z.infer<typeof effortSchema>;

export const findingSchema = z.object({
  id: z.string().uuid(),
  category: findingCategorySchema,
  observation: z.string().min(1),
  evidenceIds: z.array(z.string().uuid()),
  hypothesis: z.string().min(1),
  recommendation: z.string().min(1),
  confidence: confidenceSchema,
  validationNeeded: z.array(z.string()),
  ownerRole: z.string().min(1),
  effort: effortSchema,
  metric: z.string().min(1),
});
export type Finding = z.infer<typeof findingSchema>;
