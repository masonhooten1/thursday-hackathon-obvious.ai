import type { NextRequest } from "next/server";
import { createSettingsRoutes } from "@/app/api/_handlers/settings";
import { realSessionStore } from "@/lib/auth";
import { defaultRepository } from "@/lib/repositories";

const routes = createSettingsRoutes({
  sessionStore: realSessionStore,
  repository: defaultRepository,
});

export const GET = (req: NextRequest) => routes.GET(req);
export const POST = (req: NextRequest) => routes.POST(req);
