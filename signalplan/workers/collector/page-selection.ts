import type { PageRole } from "@/lib/contracts";

/**
 * Bounded first-party page selection (brief §Scope): at most six pages per
 * company — home, product, pricing, demo/contact, customer proof, and one
 * relevant integration or use-case page. Links come from discovered content,
 * never invented URLs. An explicitly discovered subdomain of the company's
 * domain is allowed.
 */

export interface PageCandidate {
  url: string;
  role: PageRole;
}

const TRACKING_PARAM = /^(utm_|gclid|fbclid|mc_cid|mc_eid|_hsenc|_hsmi)/i;

/** Normalize for dedupe and first-party comparison (drops hash/tracking noise). */
export function normalizePageUrl(raw: string, baseUrl?: string): string | null {
  let url: URL;
  try {
    url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  const out = url.toString();
  return out.endsWith("/") && url.pathname !== "/" ? out.slice(0, -1) : out;
}

/**
 * True when the URL belongs to the company: the domain itself, its www form,
 * or an explicitly discovered subdomain.
 */
export function isFirstParty(url: URL, domain: string): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const base = domain.toLowerCase().replace(/^www\./, "");
  return host === base || host.endsWith(`.${base}`);
}

/** Deterministic role classification from the URL path. Hyphenated variants
 * (contact-us, book-a-call) classify like their head token; compound names
 * (case-studies, use-cases) match as a whole first. */
export function classifyRole(url: URL): PageRole | null {
  const path = url.pathname.toLowerCase();
  if (path === "/" || path === "") return "home";
  const segments = path.split("/").filter(Boolean);
  for (const segment of segments) {
    for (const probe of [segment, ...segment.split("-")]) {
      if (/^(pricing|plans?|subscription)$/.test(probe)) return "pricing";
      if (/^(demo|contact|book|booking|meeting|meetings|sales|talk)$/.test(probe)) return "demo_contact";
      if (/^(customers?|case(-|)studies?|case(-|)stud(y|ies)|testimonials?|reviews?|love|proof)$/.test(probe)) {
        return "customer_proof";
      }
      if (/^(integrations?|use(-|)cases?|solutions?)$/.test(probe)) return "integration_use_case";
      if (/^(product|features?|platform|capabilities|how(-|)it(-|)works)$/.test(probe)) return "product";
    }
  }
  return null;
}

/** Selection priority after home — the brief's page list in order. */
const ROLE_PRIORITY: PageRole[] = [
  "pricing",
  "demo_contact",
  "product",
  "integration_use_case",
  "customer_proof",
];

export interface SelectPagesInput {
  domain: string;
  /** The company's home URL (e.g. https://example.com/) — always first. */
  homeUrl: string;
  /** Discovered links (DOM order) from any captured page. */
  links: string[];
  /** Maximum pages selected; the brief caps at six. */
  limit?: number;
}

/**
 * Pure selection: home plus the best (first-discovered) link per role, bounded
 * by `limit`. Unclassified links are never selected — a capture needs a role
 * from the frozen enum, and inventing one would mislabel evidence.
 */
export function selectPages(input: SelectPagesInput): PageCandidate[] {
  const limit = input.limit ?? 6;
  const out: PageCandidate[] = [];
  const seen = new Set<string>();

  const home = normalizePageUrl(input.homeUrl);
  if (home) {
    out.push({ url: home, role: "home" });
    seen.add(home);
  }

  // First-party candidates in discovery order, deduplicated.
  const candidates: { url: string; role: PageRole }[] = [];
  for (const link of input.links) {
    const normalized = normalizePageUrl(link, input.homeUrl);
    if (!normalized || seen.has(normalized)) continue;
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      continue;
    }
    if (!isFirstParty(url, input.domain)) continue;
    const role = classifyRole(url);
    if (!role || role === "home") continue;
    seen.add(normalized);
    candidates.push({ url: normalized, role });
  }

  for (const role of ROLE_PRIORITY) {
    if (out.length >= limit) break;
    const match = candidates.find((c) => c.role === role);
    if (match) out.push(match);
  }
  return out;
}
