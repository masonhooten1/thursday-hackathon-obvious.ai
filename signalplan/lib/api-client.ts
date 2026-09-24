import { getAccessToken } from "@/lib/auth-browser";

/**
 * Typed fetch wrapper for the authenticated API. Attaches the Supabase access
 * token as a Bearer header (exactly what SupabaseSessionStore extracts), maps
 * every non-2xx to an ApiError carrying the server's message, and never
 * retries automatically — duplicate run creation is prevented by the
 * idempotency key, and silent retries would double-charge BYOK model calls.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
}

export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const token = getAccessToken();
  if (token) headers["authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    // Network failure is surfaced, not swallowed — the UI renders it.
    throw new ApiError(0, `Network request failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    let details: unknown;
    try {
      const payload = (await res.json()) as { error?: string; details?: unknown };
      if (payload.error) message = payload.error;
      details = payload.details;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new ApiError(res.status, message, details);
  }
  return (await res.json()) as T;
}
