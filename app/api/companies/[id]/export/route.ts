import type { NextRequest } from "next/server";
import { createCompanyExportRoutes } from "@/app/api/_handlers/company-export";
import { realSessionStore } from "@/lib/auth";
import { defaultRepository } from "@/lib/repositories";

const routes = createCompanyExportRoutes({
  sessionStore: realSessionStore,
  repository: defaultRepository,
});

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  routes.POST(req, ctx);
