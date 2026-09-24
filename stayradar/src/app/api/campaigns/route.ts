import { NextResponse, type NextRequest } from "next/server";
import { getRequestDb } from "@/db/request-db";
import { listCampaigns } from "@/lib/services/marketing/campaign-service";

/** GET /api/campaigns — stored campaigns, newest first (?market= filters). */
export async function GET(request: NextRequest) {
  const market = new URL(request.url).searchParams.get("market") ?? undefined;
  const campaigns = await listCampaigns(getRequestDb(), market);
  return NextResponse.json({ campaigns });
}
