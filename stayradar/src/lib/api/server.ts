import { headers } from "next/headers";

/**
 * Absolute base URL for server-side API calls. Server components fetch
 * their own deployment's routes (the contract surface), so they need an
 * absolute URL. An explicitly configured internal origin wins — nested
 * SSR fetches should not hairpin back through the public edge (preview
 * proxies and some load balancers refuse or serialize that second hop).
 * Without configuration, reverse-proxy headers apply, with a localhost
 * fallback for direct dev access.
 */
export async function serverApiBaseUrl(): Promise<string> {
  const configured = process.env.STAYRADAR_SERVER_API_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const forwardedProto = h.get("x-forwarded-proto");
  const proto =
    forwardedProto ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
