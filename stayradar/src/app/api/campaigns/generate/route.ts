import { type NextRequest } from "next/server";
import { getRequestDb } from "@/db/request-db";
import { errorResponse } from "../../http";
import {
  CampaignValidationError,
  MarketNotFoundError,
  generateCampaign,
} from "@/lib/services/marketing/campaign-service";

/**
 * POST /api/campaigns/generate — build, validate, persist, and submit a
 * radius campaign for one market cluster. The service owns input validation:
 * bad_request for malformed input or a Google-limit violation (e.g. radius
 * below the 1 km proximity floor), not_found for an unknown market.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("bad_request", "Request body must be JSON");
  }

  try {
    const campaign = await generateCampaign(getRequestDb(), body);
    return Response.json({ campaign }, { status: 201 });
  } catch (error) {
    if (error instanceof CampaignValidationError) {
      return errorResponse("bad_request", error.message, error.issues);
    }
    if (error instanceof MarketNotFoundError) {
      return errorResponse("not_found", error.message);
    }
    throw error; // never swallow — unexpected failures surface as 500
  }
}
