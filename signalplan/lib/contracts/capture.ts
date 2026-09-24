import { z } from "zod";

/**
 * PageCapture contract (brief §Specialists and their contracts — Collector,
 * §Scope). At most six first-party pages per company: home, product, pricing,
 * demo/contact, customer proof, and one relevant integration or use-case page.
 */
export const pageRoleSchema = z.enum([
  "home",
  "product",
  "pricing",
  "demo_contact",
  "customer_proof",
  "integration_use_case",
]);
export type PageRole = z.infer<typeof pageRoleSchema>;

export const captureMethodSchema = z.enum(["html", "rendered_dom"]);
export type CaptureMethod = z.infer<typeof captureMethodSchema>;

export const formFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  required: z.boolean().optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formMetadataSchema = z.object({
  action: z.string().optional(),
  method: z.string().optional(),
  fields: z.array(formFieldSchema).default([]),
});
export type FormMetadata = z.infer<typeof formMetadataSchema>;

export const pageCaptureSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  url: z.string().url(),
  role: pageRoleSchema,
  method: captureMethodSchema,
  httpStatus: z.number().int().optional(),
  capturedAt: z.string().datetime(),
  // Bounded visible text; the full snapshot lives at snapshotRef in private
  // storage.
  visibleText: z.string().optional(),
  snapshotRef: z.string().optional(),
  links: z.array(z.string().url()).default([]),
  forms: z.array(formMetadataSchema).default([]),
  // Service-worker behavior, consent-gated tags, non-default browser settings —
  // anything that changes how observations should be read.
  runtimeObservations: z.array(z.string()).default([]),
  error: z.string().optional(),
  limitations: z.array(z.string()).default([]),
});
export type PageCapture = z.infer<typeof pageCaptureSchema>;
