import type { NextRequest } from "next/server";
import { createCompanyExportRoutes } from "@/app/api/_handlers/company-export";
import { realSessionStore } from "@/lib/auth";
import { defaultRepository } from "@/lib/repositories";

/**
 * Credential-free mode: without TRIGGER_SECRET_KEY the dispatch is a logged
 * no-op — the export row stays durably pending and the operator can retry the
 * moment credentials exist. Nothing pretends to have printed.
 */
async function dispatchExport(payload: {
  exportId: string;
  workspaceId: string;
  html: string;
}): Promise<void> {
  if (!process.env.TRIGGER_SECRET_KEY) {
    console.warn(
      `[trigger] TRIGGER_SECRET_KEY not configured — export ${payload.exportId} stays pending.`,
    );
    return;
  }
  const { tasks } = await import("@trigger.dev/sdk");
  await tasks.trigger("print-export", payload);
}

const routes = createCompanyExportRoutes({
  sessionStore: realSessionStore,
  repository: defaultRepository,
  dispatchExport,
});

export const POST = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
  routes.POST(req, ctx);
