import { modelSettingsMetadataSchema, saveSettingsInputSchema, type WorkspaceSettingsRecord } from "@/lib/contracts";
import { encryptSecret } from "@/lib/data/encryption";
import {
  errorResponse,
  jsonResponse,
  workspaceGuard,
  type RouteDeps,
} from "./shared";

/**
 * BYOK settings (spec §The BYOK addition). POST validates and encrypts the
 * key into workspace_settings. GET returns provider + last-four + updated_at
 * only — never key material (acceptance check 10).
 */

function toMetadata(record: WorkspaceSettingsRecord | null) {
  return modelSettingsMetadataSchema.parse({
    provider: record?.provider ?? null,
    keyLastFour: record?.keyLastFour ?? null,
    updatedAt: record?.updatedAt ?? null,
  });
}

export function createSettingsRoutes(deps: RouteDeps) {
  async function GET(req: Request): Promise<Response> {
    const guard = await workspaceGuard(req, deps);
    if (!guard.ok) return errorResponse(guard.status, guard.message);
    const record = await deps.repository.getModelSettings(guard.workspaceId);
    return jsonResponse(toMetadata(record));
  }

  async function POST(req: Request): Promise<Response> {
    const guard = await workspaceGuard(req, deps);
    if (!guard.ok) return errorResponse(guard.status, guard.message);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Request body must be JSON.");
    }
    const parsed = saveSettingsInputSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Validation failed.", parsed.error.issues);
    }

    const apiKey = parsed.data.apiKey.trim();
    const record: WorkspaceSettingsRecord = {
      workspaceId: guard.workspaceId,
      provider: parsed.data.provider,
      encryptedKey: encryptSecret(apiKey),
      keyLastFour: apiKey.slice(-4),
      updatedAt: new Date().toISOString(),
    };
    await deps.repository.saveModelSettings(guard.workspaceId, record);
    return jsonResponse(toMetadata(record), 201);
  }

  return { GET, POST };
}
