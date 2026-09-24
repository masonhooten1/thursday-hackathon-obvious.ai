import { NextResponse } from "next/server";
import {
  CampaignValidationError,
  MarketNotFoundError,
  generateCampaign,
} from "@/lib/services/marketing/campaign-service";
import { getMarketingDb } from "@/lib/services/marketing/connection";

/**
 * POST /api/campaigns/generate — build, validate, persist, and submit a
 * radius campaign for one market cluster. The service owns input validation:
 * 400 for malformed input or a Google-limit violation (e.g. radius < 1 km),
 * 404 for an unknown market.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  try {
    const campaign = await generateCampaign(getMarketingDb(), body);
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    if (error instanceof CampaignValidationError) {
      return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
    }
    if (error instanceof MarketNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error; // never swallow — unexpected failures surface as 500
  }
}
