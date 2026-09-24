/**
 * Fetch-time SSRF guard (acceptance check 8, brief §Practical safeguards).
 *
 * Domain intake (lib/contracts/domain) is the first boundary; this module is
 * the second: every URL is re-checked at fetch time — structurally, after DNS
 * resolution, and on every redirect hop — because a public hostname can still
 * resolve to a loopback, RFC1918, link-local, or cloud-metadata address.
 */

/** Error whose name the orchestration layer maps to a non-retryable "blocked" company state. */
export class BlockedDestinationError extends Error {
  constructor(readonly code: BlockedUrlCode, message: string) {
    super(message);
    this.name = "BlockedDestinationError";
  }
}

export type BlockedUrlCode =
  | "NOT_A_HOSTNAME"
  | "NOT_HTTP_S"
  | "CREDENTIALS_IN_URL"
  | "PORT_NOT_ALLOWED"
  | "IP_LITERAL_NOT_ALLOWED"
  | "RESERVED_HOST"
  | "RESERVED_TLD"
  | "RESOLVED_TO_PRIVATE_ADDRESS"
  | "REDIRECT_LIMIT";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
]);

// Pseudo-TLDs that can never be a public destination.
const BLOCKED_TLDS = new Set(["local", "localhost", "internal", "test", "example", "invalid"]);

/** IPv4 ranges a public collector may never touch. */
export function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return false;
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((n) => n > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local (includes cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** IPv6 loopback, link-local, unique-local, and IPv4-mapped forms. */
export function isBlockedIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (/^fe[89ab]/.test(h)) return true; // fe80::/10 link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique-local
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":") || host.startsWith("[");
}

/** Structural checks — no network. Throws BlockedDestinationError on any block. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedDestinationError("NOT_A_HOSTNAME", `"${raw}" is not a valid URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BlockedDestinationError("NOT_HTTP_S", `"${raw}" is not an http(s) destination.`);
  }
  if (url.username || url.password) {
    throw new BlockedDestinationError("CREDENTIALS_IN_URL", `"${raw}" embeds credentials.`);
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new BlockedDestinationError("PORT_NOT_ALLOWED", `"${raw}" uses a non-standard port.`);
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new BlockedDestinationError("RESERVED_HOST", `"${host}" is not a public website.`);
  }
  if (isBlockedIpv4(host) || isBlockedIpv6(host) || isIpLiteral(host)) {
    throw new BlockedDestinationError(
      "IP_LITERAL_NOT_ALLOWED",
      `"${host}" is an IP address — destinations must be domains.`,
    );
  }
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) {
    throw new BlockedDestinationError("NOT_A_HOSTNAME", `"${host}" is not a valid hostname.`);
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,63}$/.test(tld) || BLOCKED_TLDS.has(tld) || BLOCKED_TLDS.has(labels.slice(-2).join("."))) {
    throw new BlockedDestinationError("RESERVED_TLD", `"${host}" is not a public website domain.`);
  }
  return url;
}

/** Checks one resolved address (called for every address DNS returns). */
export function assertPublicAddress(address: string): void {
  if (isBlockedIpv4(address) || isBlockedIpv6(address)) {
    throw new BlockedDestinationError(
      "RESOLVED_TO_PRIVATE_ADDRESS",
      `"${address}" resolved to a private, loopback, link-local, or metadata address.`,
    );
  }
}

export type ResolveDns = (hostname: string) => Promise<string[]>;

/** Default resolver — injected in tests; never hit in unit runs. */
export const systemResolveDns: ResolveDns = async (hostname) => {
  const { lookup } = await import("node:dns/promises");
  const records = await lookup(hostname, { all: true });
  return records.map((r) => r.address);
};

export interface GuardedFetchDeps {
  fetchImpl?: typeof fetch;
  resolveDns?: ResolveDns;
  maxRedirects?: number;
  timeoutMs?: number;
}

/**
 * Fetch with per-hop validation: structural guard → DNS resolution check →
 * request (redirects disabled) → validate the Location and repeat. A redirect
 * chain that lands on a private address is blocked before access — including
 * hops the browser itself would otherwise follow.
 */
export async function guardedFetch(raw: string, deps: GuardedFetchDeps = {}): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resolveDns = deps.resolveDns ?? systemResolveDns;
  const maxRedirects = deps.maxRedirects ?? 5;
  const timeoutMs = deps.timeoutMs ?? 20_000;

  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = assertPublicUrl(current);
    const addresses = await resolveDns(url.hostname);
    if (addresses.length === 0) {
      throw new BlockedDestinationError("RESOLVED_TO_PRIVATE_ADDRESS", `DNS returned no addresses for "${url.hostname}".`);
    }
    for (const address of addresses) assertPublicAddress(address);

    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "SignalPlanCollector/0.1 (public website audit; contact: operator)" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      // Resolve relative Locations against the current hop, then re-validate.
      current = new URL(location, url).toString();
      continue;
    }
    return response;
  }
  throw new BlockedDestinationError("REDIRECT_LIMIT", `More than ${maxRedirects} redirects from "${raw}".`);
}
