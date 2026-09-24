import { createExportInputSchema } from "@/lib/contracts";
import {
  errorResponse,
  jsonResponse,
  workspaceGuard,
  type RouteContext,
  type RouteDeps,
} from "./shared";

/**
 * POST /api/companies/:id/export — create or retrieve an authorized private
 * export (pdf or csv). Retry/resume never duplicates an active export
 * (acceptance check 5); a failed export is replaced.
 */
export function createCompanyExportRoutes(deps: RouteDeps) {
  async function POST(req: Request, ctx: RouteContext): Promise<Response> {
    const guard = await workspaceGuard(req, deps);
    if (!guard.ok) return errorResponse(guard.status, guard.message);

    const { id: companyId } = await ctx.params;
    const company = await deps.repository.getCompany(guard.workspaceId, companyId);
    if (!company) return errorResponse(404, "Company not found.");

    let body: unknown = {};
    try {
      const text = await req.text();
      if (text.trim().length > 0) body = JSON.parse(text);
    } catch {
      return errorResponse(400, "Request body must be JSON.");
    }
    const parsed = createExportInputSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Validation failed.", parsed.error.issues);
    }

    const record = await deps.repository.getOrCreateExport(
      guard.workspaceId,
      companyId,
      parsed.data.kind,
    );
    return jsonResponse(record, record.status === "pending" ? 202 : 200);
  }

  return { POST };
}
