import { headers } from "next/headers";

/**
 * Absolute base URL for server-side API calls. Server components fetch
 * their own deployment's routes (the contract surface), so they need an
 * absolute URL — reverse-proxy headers first, localhost fallback for
 * direct dev access.
 */
export async function serverApiBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const forwardedProto = h.get("x-forwarded-proto");
  const proto =
    forwardedProto ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
