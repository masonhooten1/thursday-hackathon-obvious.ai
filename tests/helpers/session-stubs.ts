import type { Session, SessionStore } from "@/lib/auth/session";
import { InMemoryRepository } from "@/lib/repositories/in-memory";
import { randomUUID } from "node:crypto";

/**
 * Test doubles for the session layer. Handler code is exercised identically
 * in tests and production — only the store and repository are stubbed.
 */
export function stubSessionStore(tokens: Map<string, Session | null>): SessionStore {
  return {
    async getSession(req: Request): Promise<Session | null> {
      const auth = req.headers.get("authorization") ?? "";
      if (!auth.toLowerCase().startsWith("bearer ")) return null;
      return tokens.get(auth.slice(7)) ?? null;
    },
  };
}

export interface TestUsers {
  repo: InMemoryRepository;
  tokens: Map<string, Session | null>;
  tokenA: string;
  tokenB: string;
  workspaceA: string;
  workspaceB: string;
}

/** Two users, each owning one workspace — the cross-user denial fixture. */
export function makeTestUsers(): TestUsers {
  const tokenA = `token-a-${randomUUID()}`;
  const tokenB = `token-b-${randomUUID()}`;
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const sessionA = { userId: randomUUID(), email: "a@example.com" };
  const sessionB = { userId: randomUUID(), email: "b@example.com" };

  const tokens = new Map<string, Session | null>([
    [tokenA, sessionA],
    [tokenB, sessionB],
    ["invalid", null],
  ]);
  const repo = new InMemoryRepository({
    workspaces: [
      { id: workspaceA, memberUserIds: [sessionA.userId] },
      { id: workspaceB, memberUserIds: [sessionB.userId] },
    ],
    campaigns: [],
    runs: [],
    companies: [],
    exports: [],
    settings: [],
  });
  return { repo, tokens, tokenA, tokenB, workspaceA, workspaceB };
}

export function authedRequest(
  url: string,
  token: string,
  init: { method?: string; body?: unknown; workspaceId?: string } = {},
): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (init.workspaceId) headers.set("x-signalplan-workspace", init.workspaceId);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
