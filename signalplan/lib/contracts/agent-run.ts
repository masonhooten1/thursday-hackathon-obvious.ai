import { z } from "zod";

/**
 * AgentRun contract (brief §Specialists and their contracts). Every specialist
 * execution — deterministic or model-backed — records a durable run row so
 * progress survives closed browsers and retries never duplicate work. A
 * malformed model response is retried once, then surfaced as an agentRun
 * failure — never silently coerced.
 */
export const agentRoleSchema = z.enum([
  "discovery",
  "collector",
  "detector",
  "positioning",
  "funnel",
  "outbound",
  "planner",
  "writer",
  "reviewer",
]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const agentRunStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

/** Independent reviewer verdicts (brief §Specialists — Reviewer). */
export const reviewerVerdictSchema = z.enum([
  "supported",
  "revise",
  "unsupported",
  "needs_access",
]);
export type ReviewerVerdict = z.infer<typeof reviewerVerdictSchema>;

export const agentRunSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  companyId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  role: agentRoleSchema,
  status: agentRunStatusSchema,
  attempt: z.number().int().min(1).default(1),
  // Reviewer role only.
  verdict: reviewerVerdictSchema.optional(),
  error: z.string().optional(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
});
export type AgentRun = z.infer<typeof agentRunSchema>;
