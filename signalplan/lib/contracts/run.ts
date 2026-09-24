import { z } from "zod";
import { companyStatusSchema } from "./company";

/**
 * Run contract (brief §Core endpoints, §Execution settings). A run accepts a
 * batch of domains and enqueues durable company jobs. Run creation requires an
 * idempotency key so repeated clicks never duplicate companies or charges.
 */
export const runStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "partial",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runFailureSchema = z.object({
  companyId: z.string().uuid(),
  stage: companyStatusSchema,
  error: z.string().min(1),
});
export type RunFailure = z.infer<typeof runFailureSchema>;

export const runSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  status: runStatusSchema,
  idempotencyKey: z.string().min(8).max(255),
  companiesTotal: z.number().int().min(0),
  companiesReady: z.number().int().min(0),
  companiesFailed: z.number().int().min(0),
  // Cost usage against the campaign's global model-request cap.
  modelRequestsUsed: z.number().int().min(0),
  failures: z.array(runFailureSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Run = z.infer<typeof runSchema>;

export const createRunInputSchema = z.object({
  /** 1–25 first-party company domains. Search discovery is deferred. */
  domains: z.array(z.string().min(1).max(2000)).min(1).max(25),
  query: z.string().optional(),
  // Header Idempotency-Key takes precedence; body fallback for convenience.
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type CreateRunInput = z.infer<typeof createRunInputSchema>;
