"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side auth helpers. Supabase credentials are the public anon pair —
 * safe in the browser bundle; every privileged operation happens server-side
 * in the API routes, which verify the access token themselves and fail
 * closed. This module never holds a service key.
 */

const SESSION_TOKEN_KEY = "sp_access_token";

/** Route-gate cookie (UX only). Real authorization lives in the API routes. */
export const SESSION_COOKIE = "sp_session";
export const PREVIEW_COOKIE = "sp_preview";

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

let browserClient: SupabaseClient | null = null;

/** The browser Supabase client, or null when the deployment has no anon config. */
export function supabaseBrowser(): SupabaseClient | null {
  if (!isAuthConfigured()) return null;
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    );
  }
  return browserClient;
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_TOKEN_KEY);
}

export function storeAccessToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(SESSION_TOKEN_KEY, token);
  else window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

export function setSessionCookie(value: boolean): void {
  if (typeof document === "undefined") return;
  if (value) document.cookie = `${SESSION_COOKIE}=1; path=/; sameSite=lax`;
  else document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0`;
}

export function setPreviewCookie(value: boolean): void {
  if (typeof document === "undefined") return;
  if (value) document.cookie = `${PREVIEW_COOKIE}=fixtures; path=/; sameSite=lax`;
  else document.cookie = `${PREVIEW_COOKIE}=; path=/; max-age=0`;
}
