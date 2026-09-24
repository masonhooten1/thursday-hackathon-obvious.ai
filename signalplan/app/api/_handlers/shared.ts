import type { NextRequest } from "next/server";
import type { SessionStore } from "@/lib/auth/session";
import { resolveWorkspace, type WorkspaceResolution } from "@/lib/auth/session";
import type { SignalPlanRepository } from "@/lib/repositories/types";

export type RouteDeps = {
  sessionStore: SessionStore;
  repository: SignalPlanRepository;
  /** Wired to Trigger.dev in production; tests record calls. */
  enqueueRun?: (workspaceId: string, runId: string) => Promise<void>;
  /** Wired to Trigger.dev in production; tests record calls. */
  dispatchExport?: (payload: { exportId: string; workspaceId: string; html: string }) => Promise<void>;
};

export type RouteContext = { params: Promise<Record<string, string>> };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function errorResponse(status: 400 | 401 | 404 | 409 | 500, message: string, extra?: unknown): Response {
  return jsonResponse({ error: message, ...(extra === undefined ? {} : { details: extra }) }, status);
}

/** Resolve the workspace or produce the failure response for a route. */
export function workspaceGuard(
  req: Request | NextRequest,
  deps: RouteDeps,
): Promise<WorkspaceResolution> {
  return resolveWorkspace(req, deps.sessionStore, deps.repository);
}
