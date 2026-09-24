import type { NextRequest } from "next/server";
import { createCampaignsRoutes } from "@/app/api/_handlers/campaigns";
import { realSessionStore } from "@/lib/auth";
import { defaultRepository } from "@/lib/repositories";

const routes = createCampaignsRoutes({
  sessionStore: realSessionStore,
  repository: defaultRepository,
});

export const POST = (req: NextRequest) => routes.POST(req);
export const GET = (req: NextRequest) => routes.GET(req);
