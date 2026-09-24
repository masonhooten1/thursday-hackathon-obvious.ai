import type { NextRequest } from "next/server";
import { createRunStatusRoutes } from "@/app/api/_handlers/run-status";
import { realSessionStore } from "@/lib/auth";
import { defaultRepository } from "@/lib/repositories";

const routes = createRunStatusRoutes({
  sessionStore: realSessionStore,
  repository: defaultRepository,
});

export const GET = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  routes.GET(req, ctx);
