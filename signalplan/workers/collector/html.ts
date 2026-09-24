import * as cheerio from "cheerio";
import type { FormField, FormMetadata } from "@/lib/contracts";

/**
 * Deterministic HTML extraction for the collector (brief §Specialists and
 * their contracts — Collector). Parsed structure — never raw page text — is
 * what the technology detector is allowed to match against: script srcs,
 * inline script bodies, iframe srcs, forms, links. Page text is untrusted
 * data and is carried only as capture text.
 */

export interface ParsedPage {
  visibleText: string;
  links: string[];
  forms: FormMetadata[];
  /** src of external <script> tags, resolved absolute. */
  scriptSrcs: string[];
  /** Bodies of inline <script> tags — where hbspt.forms.create calls live. */
  inlineScripts: string[];
  /** src of <iframe> tags, resolved absolute. */
  iframes: string[];
  /** Client-rendering indicators (the page may need a rendered pass). */
  spaMarkers: string[];
  /** Consent-gating tooling references (tags may fire only after consent). */
  consentIndicators: string[];
}

const TRACKING_PARAM = /^(utm_|gclid|fbclid|mc_cid|mc_eid|hs_cta|_hsenc|_hsmi)/i;

/** Normalize a discovered URL: strip hash + tracking params + trailing slash. */
export function normalizeUrl(raw: string, baseUrl?: string): string | null {
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

function resolveOrDrop(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#") || /^(javascript|mailto|tel):/i.test(trimmed)) return null;
  return normalizeUrl(trimmed, baseUrl);
}

const SPA_MARKER_SELECTORS: [string, string][] = [
  ["script#__NEXT_DATA__", "next.js hydration data"],
  ["#__next", "next.js root"],
  ["[data-reactroot]", "react root"],
  ["#root", "SPA root (#root)"],
  ["#app", "SPA root (#app)"],
  ["[ng-version]", "angular root"],
  ["[data-v-app]", "vue root"],
];

const CONSENT_MARKERS: [RegExp, string][] = [
  [/cookiebot/i, "Cookiebot"],
  [/onetrust/i, "OneTrust"],
  [/osano/i, "Osano"],
  [/cookieyes/i, "CookieYes"],
  [/cookie-?consent/i, "generic cookie-consent"],
  [/iubenda/i, "Iubenda"],
];

export function parsePage(html: string, baseUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const base = $("base[href]").attr("href");
  const effectiveBase = base ? new URL(base, baseUrl).toString() : baseUrl;

  // Visible text: drop non-rendered elements, collapse whitespace, bound length.
  const clone = cheerio.load(html);
  clone("script, style, noscript, template, svg").remove();
  const visibleText = clone("body").text().replace(/\s+/g, " ").trim();

  const links: string[] = [];
  for (const el of $("a[href]").toArray()) {
    const abs = resolveOrDrop($(el).attr("href"), effectiveBase);
    if (abs && !links.includes(abs)) links.push(abs);
  }

  const forms: FormMetadata[] = $("form")
    .toArray()
    .slice(0, 20)
    .map((el) => {
      const $form = $(el);
      const fields = $form
        .find("input[name], select[name], textarea[name]")
        .toArray()
        .map((f) => {
          const $f = $(f);
          const field: FormField = { name: String($f.attr("name")) };
          if ($f.attr("type")) field.type = String($f.attr("type"));
          if ($f.attr("required") !== undefined) field.required = true;
          return field;
        });
      const meta: FormMetadata = { fields };
      const action = $form.attr("action");
      if (action) meta.action = action;
      const method = $form.attr("method");
      if (method) meta.method = method;
      return meta;
    });

  const scriptSrcs: string[] = [];
  for (const el of $("script[src]").toArray()) {
    const abs = resolveOrDrop($(el).attr("src"), effectiveBase);
    if (abs && !scriptSrcs.includes(abs)) scriptSrcs.push(abs);
  }

  const inlineScripts = $("script:not([src])")
    .toArray()
    .map((el) => $(el).text())
    .filter((t) => t.trim().length > 0);

  const iframes: string[] = [];
  for (const el of $("iframe[src]").toArray()) {
    const abs = resolveOrDrop($(el).attr("src"), effectiveBase);
    if (abs && !iframes.includes(abs)) iframes.push(abs);
  }

  const spaMarkers = SPA_MARKER_SELECTORS.filter(([sel]) => $(sel).length > 0).map(([, name]) => name);

  const consentIndicators: string[] = [];
  const htmlText = html;
  for (const [re, name] of CONSENT_MARKERS) {
    if (re.test(htmlText) && !consentIndicators.includes(name)) consentIndicators.push(name);
  }

  return { visibleText, links, forms, scriptSrcs, inlineScripts, iframes, spaMarkers, consentIndicators };
}
