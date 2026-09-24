import type { NextRequest } from "next/server";
import { createCampaignRunsRoutes } from "@/app/api/_handlers/campaign-runs";
import { realSessionStore } from "@/lib/auth";
import { defaultRepository } from "@/lib/repositories";
import { enqueueRun } from "@/trigger/enqueue";

const routes = createCampaignRunsRoutes({
  sessionStore: realSessionStore,
  repository: defaultRepository,
  enqueueRun,
});

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  routes.POST(req, ctx);
