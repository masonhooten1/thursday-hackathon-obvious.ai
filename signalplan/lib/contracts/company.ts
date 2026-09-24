import { z } from "zod";
import { campaignLimitsInputSchema, sellerOfferInputSchema } from "./campaign";
import {
  internalCrmAdoptionSchema,
  publicIntegrationStatusSchema,
} from "./hubspot";

/**
 * Company contract (brief §Execution settings). Statuses follow the brief's
 * state machine: queued → collecting → analyzing → drafting → reviewing →
 * ready, with partial, blocked, failed, and cancelled exits.
 */
export const companyStatusSchema = z.enum([
  "queued",
  "collecting",
  "analyzing",
  "drafting",
  "reviewing",
  "ready",
  "partial",
  "blocked",
  "failed",
  "cancelled",
]);
export type CompanyStatus = z.infer<typeof companyStatusSchema>;

export const hubspotEvidenceSchema = z.object({
  publicIntegration: publicIntegrationStatusSchema,
  // Stored separately from public integration evidence — never inferred from it.
  internalAdoption: internalCrmAdoptionSchema.default("unknown"),
  checkedAt: z.string().datetime().optional(),
  note: z.string().optional(),
});
export type HubSpotEvidence = z.infer<typeof hubspotEvidenceSchema>;

/**
 * Transparent ranking heuristic (brief §Ranking): ICP fit 30, evidence quality
 * 25, opportunity relevance 25, feasibility 20. Every component carries a short
 * reason. Unknown size or CRM tier stays unknown (null) — never invented points.
 */
export const companyScoreSchema = z.object({
  icpFit: z.number().min(0).max(30).nullable(),
  evidenceQuality: z.number().min(0).max(25).nullable(),
  opportunityRelevance: z.number().min(0).max(25).nullable(),
  proposalFeasibility: z.number().min(0).max(20).nullable(),
  total: z.number().min(0).max(100).nullable(),
  reasons: z.array(
    z.object({
      component: z.enum([
        "icp_fit",
        "evidence_quality",
        "opportunity_relevance",
        "proposal_feasibility",
      ]),
      reason: z.string().min(1),
    }),
  ),
});
export type CompanyScore = z.infer<typeof companyScoreSchema>;

export const companySchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  campaignId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(300),
  domain: z.string().min(1).max(300),
  status: companyStatusSchema,
  // Null until the technology detector has produced a verdict for this company.
  hubspotEvidence: hubspotEvidenceSchema.nullable(),
  score: companyScoreSchema.nullable(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Company = z.infer<typeof companySchema>;

// Re-exported so parallel builders can import the full campaign surface from
// lib/contracts without reaching into campaign.ts directly.
export { campaignLimitsInputSchema, sellerOfferInputSchema };
