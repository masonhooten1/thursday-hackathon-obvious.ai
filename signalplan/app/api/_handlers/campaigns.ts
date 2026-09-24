import { randomUUID } from "node:crypto";
import {
  campaignLimitsInputSchema,
  campaignSchema,
  createCampaignInputSchema,
} from "@/lib/contracts";
import {
  errorResponse,
  jsonResponse,
  workspaceGuard,
  type RouteDeps,
} from "./shared";

/**
 * POST /api/campaigns — create a campaign (seller offer + ICP + limits).
 * GET /api/campaigns — list the workspace's campaigns.
 */
export function createCampaignsRoutes(deps: RouteDeps) {
  async function POST(req: Request): Promise<Response> {
    const guard = await workspaceGuard(req, deps);
    if (!guard.ok) return errorResponse(guard.status, guard.message);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Request body must be JSON.");
    }
    const parsed = createCampaignInputSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Validation failed.", parsed.error.issues);
    }

    // Defaults are pinned here so stored campaigns always carry complete
    // limits (the brief's execution defaults).
    const limits = campaignLimitsInputSchema.parse(parsed.data.limits ?? {});
    const now = new Date().toISOString();
    const campaign = campaignSchema.parse({
      id: randomUUID(),
      workspaceId: guard.workspaceId,
      name: parsed.data.name,
      offer: parsed.data.offer,
      searchQuery: parsed.data.searchQuery,
      limits,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    const created = await deps.repository.createCampaign(campaign);
    return jsonResponse(created, 201);
  }

  async function GET(req: Request): Promise<Response> {
    const guard = await workspaceGuard(req, deps);
    if (!guard.ok) return errorResponse(guard.status, guard.message);
    return jsonResponse(await deps.repository.listCampaigns(guard.workspaceId));
  }

  return { POST, GET };
}
