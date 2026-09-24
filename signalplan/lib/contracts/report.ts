import { z } from "zod";
import { findingCategorySchema } from "./finding";

/**
 * AccountPlan contract — the two-page deliverable content schema (brief §The
 * two-page deliverable). Page 1: diagnosis, journey map, assessments, three
 * prioritized opportunities, 30-day roadmap. Page 2: HubSpot proposal, seller
 * outreach, success measures, source key, unknowns. Proposed items are always
 * labeled as proposals; unknown internal behavior is listed as unknowns, never
 * invented.
 */
export const journeyStepSchema = z.object({
  step: z.string().min(1).max(300),
  description: z.string().min(1).max(2000),
  evidenceIds: z.array(z.string().uuid()),
});
export type JourneyStep = z.infer<typeof journeyStepSchema>;

export const assessmentSchema = z.object({
  category: findingCategorySchema,
  summary: z.string().min(1).max(2000),
  // "requires access" for internal stages — never invented.
  evidenceIds: z.array(z.string().uuid()),
});
export type Assessment = z.infer<typeof assessmentSchema>;

export const opportunitySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(300),
  observation: z.string().min(1).max(2000),
  // Every opportunity must cite at least one evidence record.
  evidenceIds: z.array(z.string().uuid()).min(1),
  hypothesis: z.string().min(1).max(2000),
  proposedExperiment: z.string().min(1).max(2000),
  validationNeeded: z.array(z.string().min(1)).default([]),
  priority: z.number().int().min(1).max(3),
});
export type Opportunity = z.infer<typeof opportunitySchema>;

export const roadmapStepSchema = z.object({
  owner: z.string().min(1).max(200),
  experiment: z.string().min(1).max(2000),
  metric: z.string().min(1).max(500),
  // Baseline first (brief §The two-page deliverable); no invented lift.
  baseline: z.string().max(500).optional(),
});
export type RoadmapStep = z.infer<typeof roadmapStepSchema>;

export const proposedWorkflowSchema = z.object({
  label: z.literal("proposed design"),
  trigger: z.string().min(1).max(1000),
  conditions: z.array(z.string().min(1)).default([]),
  actions: z.array(z.string().min(1)),
  exitCriteria: z.array(z.string().min(1)).default([]),
  owner: z.string().min(1).max(200),
  measurement: z.string().min(1).max(1000),
  // Available features and existing processes must be validated before
  // implementation.
  prerequisites: z.array(z.string().min(1)).default([]),
});
export type ProposedWorkflow = z.infer<typeof proposedWorkflowSchema>;

export const outreachTouchSchema = z.object({
  touch: z.number().int().min(1).max(3),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(3000),
});
export type OutreachTouch = z.infer<typeof outreachTouchSchema>;

export const accountPlanStatusSchema = z.enum(["draft", "review", "ready", "exported"]);
export type AccountPlanStatus = z.infer<typeof accountPlanStatusSchema>;

export const accountPlanSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  version: z.number().int().min(1).default(1),
  status: accountPlanStatusSchema,
  diagnosis: z.object({
    company: z.string().min(1).max(300),
    scanDate: z.string().datetime(),
    offerSummary: z.string().min(1).max(2000),
    likelyBuyer: z.string().min(1).max(1000),
    businessModel: z.string().min(1).max(1000),
    uncertainty: z.array(z.string().min(1)).default([]),
    journey: z.array(journeyStepSchema),
    assessments: z.array(assessmentSchema),
  }),
  // Three well-supported opportunities per prospect (brief §Scope); partial
  // scans may support fewer.
  opportunities: z.array(opportunitySchema).min(1).max(3),
  roadmap30: z.array(roadmapStepSchema).min(1).max(6),
  hubspotProposal: proposedWorkflowSchema,
  outreach: z.object({
    // Never a person's identity or address — a buyer role and discovery
    // question.
    buyerRole: z.string().min(1).max(300),
    discoveryQuestion: z.string().min(1).max(2000),
    offer: z.string().min(1).max(2000),
    sequence: z.array(outreachTouchSchema).min(1).max(3),
    successMeasures: z.array(z.string().min(1)).default([]),
  }),
  sourceKey: z.string().min(1).max(2000),
  unknowns: z.array(z.string().min(1)).default([]),
});
export type AccountPlan = z.infer<typeof accountPlanSchema>;
