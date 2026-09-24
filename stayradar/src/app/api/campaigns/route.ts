import { NextResponse } from "next/server";
import { getMarketingDb } from "@/lib/services/marketing/connection";
import { listCampaigns } from "@/lib/services/marketing/campaign-service";

/** GET /api/campaigns — stored campaigns, newest first (?market= filters). */
export async function GET(request: Request) {
  const market = new URL(request.url).searchParams.get("market") ?? undefined;
  const campaigns = await listCampaigns(getMarketingDb(), market);
  return NextResponse.json({ campaigns });
}
