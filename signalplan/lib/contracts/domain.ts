/**
 * Domain intake validation (acceptance check 8 — intake half). Rejects
 * non-public destinations before a run is created: loopback, private/link-local,
 * and cloud-metadata hosts, IP literals, and internal pseudo-TLDs.
 *
 * The collector repeats this check at fetch time — after DNS resolution and on
 * every redirect — because a public hostname can still resolve to a private
 * address. This module is the boundary check, not the whole SSRF defense.
 */

export type DomainErrorCode =
  | "EMPTY_INPUT"
  | "NOT_A_HOSTNAME"
  | "IP_LITERAL_NOT_ALLOWED"
  | "PRIVATE_OR_LOCAL_ADDRESS"
  | "RESERVED_TLD"
  | "MALFORMED";

export type DomainParseResult =
  | { ok: true; domain: string }
  | { ok: false; code: DomainErrorCode; message: string };

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
]);

// Pseudo-TLDs that can never be a public destination.
const BLOCKED_TLDS = new Set([
  "local",
  "localhost",
  "internal",
  "test",
  "example",
  "invalid",
  "home.arpa",
]);

const HOSTNAME_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return false;
  const octets = parts.map((p) => Number.parseInt(p, 10));
  if (octets.some((n) => n > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local (includes cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique-local
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

/** Normalize operator input (bare domain or pasted URL) to a registrable hostname. */
export function parsePublicDomain(raw: string): DomainParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, code: "EMPTY_INPUT", message: "Provide a company domain." };

  let host: string;
  // Bare IPv6 ("::1", "fe80::1") and bare host:port inputs never survive URL
  // parsing as hosts — catch them before the URL hop.
  if (input.includes(":")) {
    const schemeless = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
      ? input.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      : input;
    const bare = schemeless.split("/")[0];
    if (/^[0-9a-f:]+::?[0-9a-f.]*$/i.test(bare) && bare.includes("::")) {
      return {
        ok: false,
        code: "IP_LITERAL_NOT_ALLOWED",
        message: `"${raw}" is an IPv6 address — submit the company's domain instead.`,
      };
    }
  }
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return { ok: false, code: "NOT_A_HOSTNAME", message: `"${raw}" is not a valid domain or URL.` };
  }

  // Strip a trailing dot from fully-qualified form; reject everything else that
  // URL parsing kept (ports stay out of intake — sites are 80/443).
  host = host.replace(/\.+$/, "");
  if (!host) return { ok: false, code: "EMPTY_INPUT", message: "Provide a company domain." };
  if (host.includes(":") || host.includes("@") || host.includes(" ")) {
    return {
      ok: false,
      code: "MALFORMED",
      message: `"${raw}" must be a bare domain like example.com.`,
    };
  }

  if (BLOCKED_HOSTNAMES.has(host)) {
    return {
      ok: false,
      code: "PRIVATE_OR_LOCAL_ADDRESS",
      message: `"${host}" is not a public website.`,
    };
  }

  if (isBlockedIpv4(host) || isBlockedIpv6(host) || isIpLiteral(host)) {
    return {
      ok: false,
      code: "IP_LITERAL_NOT_ALLOWED",
      message: `"${raw}" is an IP address — submit the company's domain instead.`,
    };
  }

  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => !HOSTNAME_LABEL.test(l))) {
    return { ok: false, code: "NOT_A_HOSTNAME", message: `"${raw}" is not a valid domain.` };
  }
  const tld = labels[labels.length - 1];
  if (
    !/^[a-z]{2,63}$/.test(tld) ||
    BLOCKED_TLDS.has(tld) ||
    BLOCKED_TLDS.has(labels.slice(-2).join("."))
  ) {
    return {
      ok: false,
      code: "RESERVED_TLD",
      message: `"${host}" is not a public website domain.`,
    };
  }

  return { ok: true, domain: host };
}

/** Dedupe parsed domains case-insensitively, preserving first-seen order. */
export function dedupeDomains(domains: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of domains) {
    const key = d.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}
