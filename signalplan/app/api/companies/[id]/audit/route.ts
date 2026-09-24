import type { NextRequest } from "next/server";
import { createCompanyAuditRoutes } from "@/app/api/_handlers/company-audit";
import { realSessionStore } from "@/lib/auth";
import { defaultRepository } from "@/lib/repositories";

const routes = createCompanyAuditRoutes({
  sessionStore: realSessionStore,
  repository: defaultRepository,
});

export const GET = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  routes.GET(req, ctx);
