import { z } from "zod";

/**
 * Campaign contract (brief §Product brief, §Execution settings). The seller's
 * offer is operator-editable: the operator enters the offer, ICP,
 * differentiators, proof points, exclusions, and preferred call to action.
 * Never invent the seller's customers or results.
 */
export const sellerOfferInputSchema = z.object({
  headline: z.string().min(1).max(2000),
  idealCustomerProfile: z.string().min(1).max(2000),
  differentiators: z.array(z.string().min(1)).max(20).default([]),
  proofPoints: z.array(z.string().min(1)).max(20).default([]),
  exclusions: z.array(z.string().min(1)).max(20).default([]),
  callToAction: z.string().max(2000).optional(),
});
export type SellerOffer = z.infer<typeof sellerOfferInputSchema>;

/**
 * Tunable engineering defaults from the brief §Execution settings — not
 * throughput promises.
 */
export const campaignLimitsInputSchema = z.object({
  maxCompanies: z.number().int().min(1).max(25).default(25),
  maxPagesPerCompany: z.number().int().min(1).max(6).default(6),
  maxConcurrentJobs: z.number().int().min(1).max(10).default(3),
  maxModelRequests: z.number().int().min(1).max(50).default(8),
});
export type CampaignLimits = z.infer<typeof campaignLimitsInputSchema>;

export const campaignStatusSchema = z.enum(["draft", "active", "completed", "cancelled"]);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

export const campaignSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200),
  offer: sellerOfferInputSchema,
  // Reserved for search-based discovery (deferred until a provider key exists).
  searchQuery: z.string().optional(),
  limits: campaignLimitsInputSchema,
  status: campaignStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Campaign = z.infer<typeof campaignSchema>;

export const createCampaignInputSchema = z.object({
  name: z.string().min(1).max(200),
  offer: sellerOfferInputSchema,
  limits: campaignLimitsInputSchema.partial().optional(),
  searchQuery: z.string().max(1000).optional(),
});
export type CreateCampaignInput = z.input<typeof createCampaignInputSchema>;
