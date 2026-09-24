import { createExportInputSchema } from "@/lib/contracts";
import { renderPlanHtml } from "@/reports/template";
import { errorResponse, jsonResponse, workspaceGuard, type RouteContext, type RouteDeps } from "./shared";

/**
 * POST /api/companies/:id/export — create or retrieve an authorized private
 * export (pdf or csv). Retry/resume never duplicates an active export
 * (acceptance check 5); a failed export is replaced. A pending PDF export is
 * dispatched to the print worker with template HTML pre-rendered from the
 * stored plan — the payload carries template output only, never raw prospect
 * text outside the escaped template.
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

    if (record.kind === "pdf" && record.status === "pending" && deps.dispatchExport) {
      const audit = await deps.repository.getCompanyAudit(guard.workspaceId, companyId);
      if (!audit?.accountPlan) {
        return errorResponse(409, "No account plan to export yet — run the analysis first.");
      }
      const html = renderPlanHtml({
        domain: company.domain,
        plan: audit.accountPlan,
        evidence: audit.evidence,
      });
      try {
        await deps.dispatchExport({ exportId: record.id, workspaceId: guard.workspaceId, html });
      } catch (err) {
        // The export row is durably pending; dispatch failure is surfaced so
        // the operator can retry without creating a duplicate export.
        console.error("Export dispatch failed — export stays pending.", err);
        return jsonResponse({ export: record, dispatchError: "Worker dispatch failed; export is queued." }, 202);
      }
      return jsonResponse({ export: record, dispatched: true }, 202);
    }

    return jsonResponse(record, record.status === "pending" ? 202 : 200);
  }

  return { POST };
}
