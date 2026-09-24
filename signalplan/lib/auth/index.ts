import "server-only";
import type { SessionStore } from "./session";
import { SupabaseSessionStore } from "./supabase-session-store";

/** Singleton store for production route files. */
export const realSessionStore: SessionStore = new SupabaseSessionStore();
export type { Session, SessionStore } from "./session";
export { resolveWorkspace } from "./session";
export { SupabaseSessionStore } from "./supabase-session-store";
