import { type NextRequest } from "next/server";
import { getRequestDb } from "@/db/request-db";
import { getCampaign, markExported } from "@/lib/services/marketing/campaign-service";
import { errorResponse } from "../../../http";
import { campaignConfigToCsv, campaignConfigToJson, exportFilename } from "@/lib/services/marketing/export";
import { CampaignConfigSchema } from "@/lib/services/marketing/schemas";

/**
 * GET /api/campaigns/[id]/export?format=json|csv — download a stored config
 * for Google Ads Editor import (the real handoff workflow until a live
 * developer token exists). A successful download marks the campaign exported.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const db = getRequestDb();

  // Malformed uuids fail the service's id guard too — both miss as 404.
  const stored = await getCampaign(db, id);
  if (!stored) {
    return errorResponse("not_found", "Campaign not found");
  }

  // Defense in depth: re-validate what a previous process persisted before
  // handing it to an ad platform.
  const parsed = CampaignConfigSchema.safeParse(stored.config);
  if (!parsed.success) {
    return errorResponse(
      "internal_error",
      "Stored config failed validation",
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      500,
    );
  }

  const body = format === "csv" ? campaignConfigToCsv(parsed.data) : campaignConfigToJson(parsed.data);
  await markExported(db, id);

  return new Response(body, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json",
      "Content-Disposition": `attachment; filename="${exportFilename(stored.market, format)}"`,
    },
  });
}
