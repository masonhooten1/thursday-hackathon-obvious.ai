import { z } from "zod";
import { evidenceMethodSchema } from "./evidence";
import { publicIntegrationStatusSchema } from "./hubspot";

/**
 * TechnologySignal contract (brief §Specialists and their contracts —
 * Technology detector, §What counts as HubSpot evidence). Signals record
 * vendor, signature, page, collection method, and integration status. Parsed
 * hosts and actual script/form context are validated — arbitrary page text
 * matches are not signals. A code sample in a blog post is never an installed
 * script.
 */
export const technologySignalSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  vendor: z.string().min(1).max(200),
  signature: z.string().min(1).max(500),
  pageUrl: z.string().url().optional(),
  method: evidenceMethodSchema,
  integrationStatus: publicIntegrationStatusSchema,
  detectedAt: z.string().datetime(),
  locator: z.string().optional(),
  excerpt: z.string().optional(),
  // Recorded without inferring how the company organizes its accounts.
  conflictingPortalIds: z.array(z.string()).default([]),
});
export type TechnologySignal = z.infer<typeof technologySignalSchema>;
