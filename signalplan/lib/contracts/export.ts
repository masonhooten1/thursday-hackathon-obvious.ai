import { z } from "zod";

/**
 * Export contract (brief §Interface, §Core endpoints). Exports are created or
 * retrieved through an authorized endpoint; retry/resume must not duplicate
 * them.
 */
export const exportKindSchema = z.enum(["pdf", "csv"]);
export type ExportKind = z.infer<typeof exportKindSchema>;

export const exportStatusSchema = z.enum(["pending", "ready", "failed"]);
export type ExportStatus = z.infer<typeof exportStatusSchema>;

export const createExportInputSchema = z.object({
  kind: exportKindSchema,
});
export type CreateExportInput = z.infer<typeof createExportInputSchema>;

export const exportSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  kind: exportKindSchema,
  status: exportStatusSchema,
  // Private storage key — downloads go through short-lived signed URLs after
  // authorization, never a public URL.
  storageKey: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});
export type Export = z.infer<typeof exportSchema>;
