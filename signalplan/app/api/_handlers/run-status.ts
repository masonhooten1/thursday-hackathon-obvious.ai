import { errorResponse, jsonResponse, workspaceGuard, type RouteContext, type RouteDeps } from "./shared";

/**
 * GET /api/runs/:id — durable progress: run state, per-company states,
 * failures, and cost usage. Closing the browser changes nothing; reconnecting
 * shows the same truth (acceptance check 11).
 */
export function createRunStatusRoutes(deps: RouteDeps) {
  async function GET(req: Request, ctx: RouteContext): Promise<Response> {
    const guard = await workspaceGuard(req, deps);
    if (!guard.ok) return errorResponse(guard.status, guard.message);

    const { id } = await ctx.params;
    const run = await deps.repository.getRun(guard.workspaceId, id);
    if (!run) return errorResponse(404, "Run not found.");
    const companies = await deps.repository.listRunCompanies(guard.workspaceId, id);
    return jsonResponse({
      run,
      companies: companies.map((c) => ({
        id: c.id,
        name: c.name,
        domain: c.domain,
        status: c.status,
        hubspotEvidence: c.hubspotEvidence,
        score: c.score,
      })),
    });
  }

  return { GET };
}

/**
 * POST /api/runs/:id/cancel — stop dispatching and cancel queued companies.
 * In-flight worker tasks honour cancellation through their checkpoints.
 */
export function createRunCancelRoutes(deps: RouteDeps) {
  async function POST(req: Request, ctx: RouteContext): Promise<Response> {
    const guard = await workspaceGuard(req, deps);
    if (!guard.ok) return errorResponse(guard.status, guard.message);

    const { id } = await ctx.params;
    const run = await deps.repository.cancelRun(guard.workspaceId, id);
    if (!run) return errorResponse(404, "Run not found.");
    return jsonResponse({ run });
  }

  return { POST };
}
