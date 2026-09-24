import { z } from "zod";

/**
 * Frozen HubSpot evidence statuses (spec §Frozen contracts, brief §What counts
 * as HubSpot evidence).
 *
 * Public integration evidence never becomes a claim about internal CRM
 * adoption — the two are stored separately and must not be conflated.
 */
export const publicIntegrationStatusSchema = z.enum([
  "observed",
  "probable",
  "not_observed",
  "scan_incomplete",
]);
export type PublicIntegrationStatus = z.infer<typeof publicIntegrationStatusSchema>;

export const internalCrmAdoptionSchema = z.enum([
  "unknown",
  "first_party_reported",
  "authorized_connection_verified",
]);
export type InternalCrmAdoption = z.infer<typeof internalCrmAdoptionSchema>;
