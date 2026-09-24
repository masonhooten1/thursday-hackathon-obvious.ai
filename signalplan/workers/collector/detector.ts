import { randomUUID } from "node:crypto";
import type {
  EvidenceMethod,
  PageCapture,
  PublicIntegrationStatus,
  TechnologySignal,
} from "@/lib/contracts";
import type { ParsedPage } from "./html";
import type { NetworkRequest } from "./render";

/**
 * Deterministic HubSpot signature detector (brief §What counts as HubSpot
 * evidence). Validates script/form context — parsed structure, never raw page
 * text. A code sample in a blog post is not an installed script; a page that
 * merely mentions HubSpot produces no signal at all.
 *
 * Statuses are the frozen four-valued public-integration enum; internal CRM
 * adoption is never inferred here (it is stored separately — a public scan
 * always leaves it "unknown").
 */

// Script hosts HubSpot's public embeds load from. Suffix matching covers the
// regional variants (js-eu1.hs-scripts.com, forms-eu1.hsforms.net, ...).
const HS_SCRIPT_HOST_SUFFIXES = [
  "hs-scripts.com", // tracking code loader
  "hs-analytics.net",
  "hscollectedforms.net",
  "hsleadflows.net",
  "hs-banner.com",
  "usemessages.com",
  "hsadspixel.net",
  "hsforms.net", // forms embed script
];

const HS_FORM_IFRAME_HOST_SUFFIXES = ["forms.hubspot.com", "hsforms.net"];

/** The classic embedded-forms API call — validated inside inline script bodies. */
const HS_FORM_CREATE_CALL = /\bhbspt\s*\.\s*forms\s*\.\s*create\s*\(/;

/** Extracts the portal id from a js.hs-scripts.com/<portal>.js loader URL. */
export function portalIdFromLoaderUrl(url: string): string | null {
  try {
    const match = /\/(\d+)(?:-\w+)?\.js$/.exec(new URL(url).pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function hostMatches(host: string, suffixes: string[]): boolean {
  const h = host.toLowerCase();
  return suffixes.some((s) => h === s || h.endsWith(`.${s}`));
}

/** Paths that carry first-party legal/disclosure text (privacy, subprocessors). */
const FIRST_PARTY_DISCLOSURE_PATH =
  /\/(privacy|privacypolicy|subprocessors?|sub-?processors?|terms|legal|gdpr|dpa)(\/|$)/i;

/** The HubSpot mention inside a first-party disclosure (data, not instructions). */
const HUBSPOT_MENTION = /\bHubSpot\b/i;

function sentenceAround(text: string, index: number, radius = 140): string {
  const start = Math.max(0, text.lastIndexOf(".", index - radius) + 1);
  const end = text.indexOf(".", index + radius);
  return text.slice(start, end === -1 ? text.length : end + 1).replace(/\s+/g, " ").trim();
}

/** One page offered to the detector: the stored capture plus its parsed structure. */
export interface PageForDetection {
  capture: PageCapture;
  parsed: ParsedPage;
}

export interface DetectorInput {
  companyId: string;
  pages: PageForDetection[];
  /** Network requests observed during rendered passes, if any. */
  networkRequests: NetworkRequest[];
  now: Date;
}

export interface DetectorOutput {
  signals: TechnologySignal[];
  /** Portal ids seen across loaders/forms — recorded, never interpreted. */
  portalIds: string[];
}

export function detectFromCaptures(input: DetectorInput): DetectorOutput {
  const signals: TechnologySignal[] = [];
  const portalIds: string[] = [];

  function signal(
    signature: string,
    method: EvidenceMethod,
    integrationStatus: PublicIntegrationStatus,
    extra: { pageUrl?: string; locator?: string; excerpt?: string } = {},
  ): void {
    signals.push({
      id: randomUUID(),
      companyId: input.companyId,
      vendor: "HubSpot",
      signature,
      method,
      integrationStatus,
      detectedAt: input.now.toISOString(),
      conflictingPortalIds: [],
      ...extra,
    });
  }

  function notePortal(candidate: string | null): void {
    if (candidate && !portalIds.includes(candidate)) portalIds.push(candidate);
  }

  for (const { capture, parsed } of input.pages) {
    const method: EvidenceMethod = capture.method === "rendered_dom" ? "rendered_dom" : "html";

    // External script loaders (js.hs-scripts.com/<portal>.js and friends).
    for (const src of parsed.scriptSrcs) {
      let host: string;
      try {
        host = new URL(src).hostname;
      } catch {
        continue;
      }
      if (!hostMatches(host, HS_SCRIPT_HOST_SUFFIXES)) continue;
      notePortal(portalIdFromLoaderUrl(src));
      signal(`script src ${host}`, method, "observed", {
        pageUrl: capture.url,
        locator: `script[src="${src}"]`,
        excerpt: src,
      });
    }

    // Inline embedded-form API calls — hbspt.forms.create( in executed script
    // bodies. Code samples in <code>/<pre> blocks are page text, not scripts,
    // so they never reach this check.
    for (const body of parsed.inlineScripts) {
      if (!HS_FORM_CREATE_CALL.test(body)) continue;
      const portalMatch = /portalId\s*:\s*["'](\d+)["']/.exec(body);
      notePortal(portalMatch?.[1] ?? null);
      signal("hbspt.forms.create embed call", method, "observed", {
        pageUrl: capture.url,
        locator: "inline script hbspt.forms.create",
        excerpt: body.replace(/\s+/g, " ").slice(0, 280),
      });
    }

    // HubSpot form iframes.
    for (const src of parsed.iframes) {
      let host: string;
      try {
        host = new URL(src).hostname;
      } catch {
        continue;
      }
      if (!hostMatches(host, HS_FORM_IFRAME_HOST_SUFFIXES)) continue;
      signal(`form iframe src ${host}`, method, "observed", {
        pageUrl: capture.url,
        locator: `iframe[src="${src}"]`,
        excerpt: src,
      });
    }

    // First-party disclosure text — supporting evidence only (probable), and
    // only on first-party legal/privacy/subprocessor pages.
    let disclosurePath = false;
    let pathname = "";
    try {
      pathname = new URL(capture.url).pathname;
      disclosurePath = FIRST_PARTY_DISCLOSURE_PATH.test(pathname);
    } catch {
      disclosurePath = false;
    }
    if (capture.visibleText && disclosurePath && HUBSPOT_MENTION.test(capture.visibleText)) {
      const index = capture.visibleText.search(HUBSPOT_MENTION);
      signal("first-party disclosure mentions HubSpot", "first_party_text", "probable", {
        pageUrl: capture.url,
        locator: `visible text of ${pathname}`,
        excerpt: sentenceAround(capture.visibleText, index),
      });
    }
  }

  // Network requests observed during rendering — request metadata evidence.
  for (const request of input.networkRequests) {
    let host: string;
    try {
      host = new URL(request.url).hostname;
    } catch {
      continue;
    }
    if (!hostMatches(host, HS_SCRIPT_HOST_SUFFIXES) && !hostMatches(host, HS_FORM_IFRAME_HOST_SUFFIXES)) {
      continue;
    }
    notePortal(portalIdFromLoaderUrl(request.url));
    signal(`network request to ${host}`, "network", "observed", {
      locator: `request ${request.method} ${request.url}`,
      excerpt: request.url,
    });
  }

  // Conflicting portal ids recorded without inferring account organization.
  if (portalIds.length > 1) {
    for (const s of signals) s.conflictingPortalIds = [...portalIds];
  }

  return { signals, portalIds };
}

/**
 * Status derivation (spec check 2 semantics): observed/probable evidence
 * speaks for itself; a negative result is only "not_observed" when the scan
 * was complete — otherwise "scan_incomplete".
 */
export function derivePublicIntegrationStatus(
  signals: TechnologySignal[],
  scanIncomplete: boolean,
): PublicIntegrationStatus {
  if (signals.some((s) => s.integrationStatus === "observed")) return "observed";
  if (signals.some((s) => s.integrationStatus === "probable")) return "probable";
  return scanIncomplete ? "scan_incomplete" : "not_observed";
}
