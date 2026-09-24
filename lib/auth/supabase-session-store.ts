import "server-only";
import { jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import type { Session, SessionStore } from "./session";

/**
 * Real Supabase session verification. Production route files bind this store;
 * tests bind a stub through the handler factories instead of importing this
 * module.
 *
 * Fails closed on any verification error — a malformed, expired, or
 * wrong-issuer token is indistinguishable from no session.
 */
export class SupabaseSessionStore implements SessionStore {
  constructor(
    private readonly secret: () => string = () => process.env.SUPABASE_JWT_SECRET ?? "",
  ) {}

  async getSession(req: Request | NextRequest): Promise<Session | null> {
    const token = this.extractToken(req);
    if (!token) return null;
    const secret = this.secret();
    if (!secret) return null; // fail closed, never trust-and-warn
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(secret),
        { algorithms: ["HS256"] },
      );
      if (!payload.sub) return null;
      // Supabase access tokens carry an `aud` of the client key (typically
      // "authenticated"); anything else is not a user session.
      if (payload.aud && payload.aud !== "authenticated") return null;
      return {
        userId: payload.sub,
        email: typeof payload.email === "string" ? payload.email : null,
      };
    } catch {
      return null;
    }
  }

  private extractToken(req: Request | NextRequest): string | null {
    const auth = req.headers.get("authorization");
    if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
    // Supabase JS sessions are usually forwarded via cookies when the browser
    // talks through the app domain.
    const cookie = req.headers.get("cookie") ?? "";
    for (const part of cookie.split(/; */)) {
      const [name, ...rest] = part.split("=");
      if ((name === "sb-access-token" || name === "sb:token") && rest.length > 0) {
        return decodeURIComponent(rest.join("="));
      }
    }
    return null;
  }
}
