import type { NextRequest } from "next/server";
import { createRunCancelRoutes } from "@/app/api/_handlers/run-status";
import { realSessionStore } from "@/lib/auth";
import { defaultRepository } from "@/lib/repositories";

const routes = createRunCancelRoutes({
  sessionStore: realSessionStore,
  repository: defaultRepository,
});

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  routes.POST(req, ctx);
