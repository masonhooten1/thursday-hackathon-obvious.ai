import { z } from "zod";

/**
 * BYOK settings contracts (spec §The BYOK addition). Keys arrive via
 * POST /api/settings, are validated, then written to workspace_settings in
 * Supabase. GET never returns key material — only provider + last-four +
 * updated_at. Workers read keys through the service-role connection; the
 * browser bundle never sees them.
 */
export const modelProviderSchema = z.enum(["openai", "anthropic"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const saveSettingsInputSchema = z.object({
  provider: modelProviderSchema,
  apiKey: z.string().min(8).max(400),
});
export type SaveSettingsInput = z.infer<typeof saveSettingsInputSchema>;

/** GET /api/settings response — metadata only, never key material. */
export const modelSettingsMetadataSchema = z.object({
  provider: modelProviderSchema.nullable(),
  keyLastFour: z.string().length(4).nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type ModelSettingsMetadata = z.infer<typeof modelSettingsMetadataSchema>;

/**
 * Server-side record shape (with encrypted key material) as stored in
 * workspace_settings. Never returned to the client; workers decrypt only in
 * the model adapter path.
 */
export const workspaceSettingsRecordSchema = z.object({
  workspaceId: z.string().uuid(),
  provider: modelProviderSchema.nullable(),
  encryptedKey: z.string().nullable(),
  keyLastFour: z.string().length(4).nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type WorkspaceSettingsRecord = z.infer<typeof workspaceSettingsRecordSchema>;
