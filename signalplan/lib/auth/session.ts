import type { NextRequest } from "next/server";

/**
 * Session abstraction for route handlers (spec §Endpoints: "Every handler
 * re-validates session and resource ownership"). The real store verifies
 * Supabase access tokens; tests inject a stub store through the handler
 * factories so route logic is exercised identically.
 */
export interface Session {
  userId: string;
  email: string | null;
}

export interface SessionStore {
  getSession(req: Request | NextRequest): Promise<Session | null>;
}

export const AUTHORIZATION_FAILED_MESSAGE = "Authentication required.";
export const FORBIDDEN_MESSAGE = "No access to this resource.";

/** Result of route authentication: either a session+workspace or a failure. */
export type WorkspaceResolution =
  | { ok: true; session: Session; workspaceId: string }
  | { ok: false; status: 401 | 404; message: string };

/**
 * Resolve the session and the workspace the request operates on. The client
 * passes the workspace via the `X-SignalPlan-Workspace` header; the session's
 * membership decides access (never the header alone).
 */
export async function resolveWorkspace(
  req: Request | NextRequest,
  store: SessionStore,
  repo: { listWorkspaceIdsForUser(userId: string): Promise<string[]> },
): Promise<WorkspaceResolution> {
  const session = await store.getSession(req);
  if (!session) return { ok: false, status: 401, message: AUTHORIZATION_FAILED_MESSAGE };

  const header = req.headers.get("x-signalplan-workspace");
  const memberships = await repo.listWorkspaceIdsForUser(session.userId);
  if (!header) {
    if (memberships.length !== 1) {
      return {
        ok: false,
        status: 401,
        message: "Workspace must be selected — send X-SignalPlan-Workspace.",
      };
    }
    return { ok: true, session, workspaceId: memberships[0] };
  }
  if (!memberships.includes(header)) {
    // 404, not 403: existence of the other workspace is not disclosed.
    return { ok: false, status: 404, message: FORBIDDEN_MESSAGE };
  }
  return { ok: true, session, workspaceId: header };
}
