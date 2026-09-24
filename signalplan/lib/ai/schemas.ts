import { z } from "zod";
import {
  accountPlanSchema,
  assessmentSchema,
  confidenceSchema,
  effortSchema,
  findingCategorySchema,
  journeyStepSchema,
  proposedWorkflowSchema,
  reviewerVerdictSchema,
} from "@/lib/contracts";

/**
 * Structured results for the six model-backed roles (brief §Specialists and
 * their contracts). Every role emits schema-validated JSON; the adapter is
 * the enforcement point. Analyst outputs carry `findings` drafts —
 * Finding-shaped but without ids, which the pipeline assigns when persisting
 * so a retry never duplicates rows.
 */

/** Model-supplied judgement levels; "unknown" never receives invented points. */
export const levelSchema = z.enum(["strong", "partial", "weak", "unknown"]);
export type Level = z.infer<typeof levelSchema>;

export const levelJudgementSchema = z.object({
  level: levelSchema,
  reason: z.string().min(1).max(1000),
});
export type LevelJudgement = z.infer<typeof levelJudgementSchema>;

export const findingDraftSchema = z.object({
  category: findingCategorySchema,
  observation: z.string().min(1).max(2000),
  // Analysts must cite collected evidence — the reviewer and the pipeline
  // both reject uncited observations.
  evidenceIds: z.array(z.string().uuid()).min(1),
  hypothesis: z.string().min(1).max(2000),
  recommendation: z.string().min(1).max(2000),
  confidence: confidenceSchema,
  validationNeeded: z.array(z.string().min(1)).max(10).default([]),
  ownerRole: z.string().min(1).max(200),
  effort: effortSchema,
  metric: z.string().min(1).max(500),
});
export type FindingDraft = z.output<typeof findingDraftSchema>;

export const positioningOutputSchema = z.object({
  summary: z.string().min(1).max(4000),
  likelyBuyer: z.string().min(1).max(1000),
  businessModel: z.string().min(1).max(1000),
  uncertainty: z.array(z.string().min(1)).max(10).default([]),
  journey: z.array(journeyStepSchema).max(6).default([]),
  assessments: z.array(assessmentSchema).max(6).default([]),
  icpFit: levelJudgementSchema,
  findings: z.array(findingDraftSchema).max(6).default([]),
});
export type PositioningOutput = z.infer<typeof positioningOutputSchema>;

export const funnelOutputSchema = z.object({
  observedSteps: z.array(journeyStepSchema).max(8).default([]),
  frictionFindings: z.array(findingDraftSchema).max(6).default([]),
  // Questions that need private data — never answered from public pages.
  privateDataQuestions: z.array(z.string().min(1)).max(10).default([]),
});
export type FunnelOutput = z.infer<typeof funnelOutputSchema>;

export const accountFieldSchema = z.object({
  field: z.string().min(1).max(200),
  // Each field carries its source; missing information stays missing.
  source: z.string().min(1).max(1000),
  evidenceIds: z.array(z.string().uuid()).max(10).default([]),
  confidence: confidenceSchema.default("low"),
});
export type AccountField = z.infer<typeof accountFieldSchema>;

export const outboundOutputSchema = z.object({
  proposedIcp: z.string().min(1).max(2000),
  accountFields: z.array(accountFieldSchema).max(10).default([]),
  qualificationRules: z.array(z.string().min(1)).max(10).default([]),
  unresolvedFacts: z.array(z.string().min(1)).max(10).default([]),
  offerAlignment: levelJudgementSchema,
  findings: z.array(findingDraftSchema).max(6).default([]),
});
export type OutboundOutput = z.infer<typeof outboundOutputSchema>;

export const plannerOutputSchema = z.object({
  workflow: proposedWorkflowSchema,
  // Required access/tier checks — validated before any implementation claim.
  tierOrAccessChecks: z.array(z.string().min(1)).max(8).default([]),
  validationExperiment: z.string().min(1).max(2000),
  feasibility: levelJudgementSchema,
  findings: z.array(findingDraftSchema).max(4).default([]),
});
export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

/** The writer emits everything but identity and lifecycle — the pipeline owns those. */
export const accountPlanContentSchema = accountPlanSchema.omit({
  id: true,
  companyId: true,
  workspaceId: true,
  version: true,
  status: true,
});
export type AccountPlanContent = z.infer<typeof accountPlanContentSchema>;

export const reviewerClaimSchema = z.object({
  // Opportunity id, assessment category, or a section path the reviewer cites.
  ref: z.string().min(1).max(300),
  status: z.enum(["supported", "unsupported", "needs_access"]),
  reason: z.string().min(1).max(1000),
});
export type ReviewerClaim = z.infer<typeof reviewerClaimSchema>;

export const reviewerOutputSchema = z.object({
  verdict: reviewerVerdictSchema,
  claims: z.array(reviewerClaimSchema).max(30).default([]),
  // What the writer must change when the verdict is "revise".
  revisionNotes: z.string().max(2000).default(""),
});
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;
