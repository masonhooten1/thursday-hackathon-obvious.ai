import { errorResponse, jsonResponse, workspaceGuard, type RouteContext, type RouteDeps } from "./shared";

/**
 * GET /api/companies/:id/audit — evidence, technology signals, findings,
 * review status, and the account plan. Every observation in the plan resolves
 * to an evidence record (acceptance check 4).
 */
export function createCompanyAuditRoutes(deps: RouteDeps) {
  async function GET(req: Request, ctx: RouteContext): Promise<Response> {
    const guard = await workspaceGuard(req, deps);
    if (!guard.ok) return errorResponse(guard.status, guard.message);

    const { id } = await ctx.params;
    const bundle = await deps.repository.getCompanyAudit(guard.workspaceId, id);
    if (!bundle) return errorResponse(404, "Company not found.");
    return jsonResponse(bundle);
  }

  return { GET };
}
