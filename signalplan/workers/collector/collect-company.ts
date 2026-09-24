import { randomUUID } from "node:crypto";
import type { Evidence, HubSpotEvidence, PageCapture, TechnologySignal } from "@/lib/contracts";
import { parsePage } from "./html";
import type { ParsedPage } from "./html";
import { selectPages } from "./page-selection";
import type { PageCandidate } from "./page-selection";
import type { NetworkRequest, PageRenderer } from "./render";
import { detectFromCaptures, derivePublicIntegrationStatus } from "./detector";
import type { PageForDetection } from "./detector";

/**
 * The collector pipeline (brief §Specialists and their contracts — Collector,
 * spec §The four modules — Collector). Bounded: ≤6 first-party pages, one HTML
 * pass, rendering only for pages that need it, one active request at a time.
 *
 * Ports are injected so the pipeline is hermetically testable; the production
 * wiring (fetch via the SSRF guard, Playwright renderer, Postgres store) lives
 * in index.ts and trigger/seams.ts. Nothing here fabricates evidence — failed
 * fetches become limitations and coverage events that drive `scan_incomplete`,
 * never a negative result (spec check 2).
 */

export interface FetchPageResult {
  /** Final URL after redirects — the capture is where this content came from. */
  finalUrl: string;
  httpStatus: number;
  body: string;
}

export type FetchPage = (url: string) => Promise<FetchPageResult>;

export interface SnapshotStore {
  /** Persists content in private storage and returns its key, or null. */
  put(workspaceId: string, companyId: string, captureId: string, content: string): Promise<string | null>;
}

export interface CollectorStore {
  savePageCaptures(workspaceId: string, companyId: string, captures: PageCapture[]): Promise<void>;
  saveTechnologySignals(workspaceId: string, companyId: string, signals: TechnologySignal[]): Promise<void>;
  saveEvidence(workspaceId: string, companyId: string, evidence: Evidence[]): Promise<void>;
  setCompanyHubspotEvidence(
    workspaceId: string,
    companyId: string,
    hubspotEvidence: HubSpotEvidence,
  ): Promise<void>;
}

export interface CollectorResult {
  captures: PageCapture[];
  signals: TechnologySignal[];
  evidence: Evidence[];
  hubspotEvidence: HubSpotEvidence;
}

export interface CollectorCompany {
  companyId: string;
  domain: string;
  workspaceId: string;
}

export interface CollectorOptions {
  fetchPage: FetchPage;
  /** Absent → rendering is unavailable; candidates get a limitation instead. */
  renderPage?: PageRenderer;
  store: CollectorStore;
  snapshotStore?: SnapshotStore;
  now?: () => Date;
  maxPages?: number;
  maxRenders?: number;
}

const VISIBLE_TEXT_LIMIT = 12_000;
const EXCERPT_LIMIT = 280;

export function excerptOf(text: string, limit = EXCERPT_LIMIT): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}

/**
 * Deterministic render policy (brief §Scope: "browser rendering only for
 * pages that need it, such as a demo page with a client-rendered form"):
 * demo/contact pages (embeds are usually script-created), and pages whose
 * text or links are suspiciously absent while SPA markers show the content
 * is client-rendered. Bounded by maxRenders at the call site.
 */
function needsRender(candidate: PageCandidate, parsed: ParsedPage): boolean {
  if (candidate.role === "demo_contact") return true;
  return (parsed.visibleText.length < 200 || parsed.links.length === 0) && parsed.spaMarkers.length > 0;
}

export async function collectCompany(
  company: CollectorCompany,
  opts: CollectorOptions,
): Promise<CollectorResult> {
  const now = opts.now ?? (() => new Date());
  const maxPages = opts.maxPages ?? 6;
  const maxRenders = opts.maxRenders ?? 2;

  const captures: PageCapture[] = [];
  const pagesForDetection: PageForDetection[] = [];
  const evidence: Evidence[] = [];
  const networkRequests: NetworkRequest[] = [];
  let scanIncomplete = false;
  let renderBudget = maxRenders;

  function newEvidence(input: Omit<Evidence, "id" | "companyId" | "capturedAt">): Evidence {
    return { id: randomUUID(), companyId: company.companyId, capturedAt: now().toISOString(), ...input };
  }

  async function capturePage(candidate: PageCandidate): Promise<void> {
    const capturedAt = now().toISOString();
    const captureId = randomUUID();
    const limitations: string[] = [];
    let method: PageCapture["method"] = "html";
    let httpStatus: number | undefined;
    let parsed: ParsedPage | undefined;
    let finalUrl = candidate.url;

    try {
      const fetched = await opts.fetchPage(candidate.url);
      finalUrl = fetched.finalUrl;
      httpStatus = fetched.httpStatus;
      parsed = parsePage(fetched.body, fetched.finalUrl);
      if (httpStatus >= 400) limitations.push(`http ${httpStatus}`);

      // Selective render upgrade — the rendered DOM supersedes the HTML pass
      // for this URL, and network events from the render become evidence.
      if (needsRender(candidate, parsed)) {
        if (!opts.renderPage) {
          limitations.push("render required but renderer unavailable");
          scanIncomplete = true;
        } else if (renderBudget > 0) {
          renderBudget -= 1;
          const rendered = await opts.renderPage.render(candidate.url);
          finalUrl = rendered.finalUrl;
          httpStatus = rendered.httpStatus;
          parsed = parsePage(rendered.html, rendered.finalUrl);
          method = "rendered_dom";
          limitations.push("rendered pass — content/behaviour not present in initial HTML");
          networkRequests.push(...rendered.requests);
          for (const observation of rendered.observations) limitations.push(observation);
        } else {
          limitations.push("render budget exhausted");
          scanIncomplete = true;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "BlockedDestinationError") throw err;
      // Capture failures are coverage events, not company failures (check 3).
      scanIncomplete = true;
      limitations.push(err instanceof Error ? `fetch failed: ${err.message}` : "fetch failed");
    }

    let snapshotRef: string | undefined;
    if (parsed && opts.snapshotStore) {
      const ref = await opts.snapshotStore.put(
        company.workspaceId,
        company.companyId,
        captureId,
        parsed.visibleText,
      );
      if (ref) snapshotRef = ref;
      else limitations.push("snapshot storage unavailable — excerpt only");
    }
    const failed = parsed === undefined;
    if (failed) limitations.push("no content captured");

    const capture: PageCapture = {
      id: captureId,
      companyId: company.companyId,
      url: finalUrl,
      role: candidate.role,
      method,
      httpStatus,
      capturedAt,
      visibleText: parsed?.visibleText.slice(0, VISIBLE_TEXT_LIMIT),
      snapshotRef,
      links: parsed?.links.slice(0, 100) ?? [],
      forms: parsed?.forms ?? [],
      runtimeObservations: parsed
        ? [
            ...(parsed.spaMarkers.length > 0
              ? [`client-rendered: ${parsed.spaMarkers.join(", ")}`]
              : []),
            ...parsed.consentIndicators.map(
              (name) => `consent gate detected (${name}) — tags may fire only after consent`,
            ),
          ]
        : [],
      error: failed ? "capture failed" : undefined,
      limitations,
    };
    captures.push(capture);

    if (parsed) pagesForDetection.push({ capture, parsed });
    evidence.push(
      newEvidence({
        url: finalUrl,
        method,
        excerpt: parsed ? excerptOf(parsed.visibleText) : "capture failed — no content",
        snapshotRef,
        limitations,
      }),
    );
  }

  // Home first — page selection uses links discovered there, never invented URLs.
  await capturePage({ url: `https://${company.domain}/`, role: "home" });
  const homeCapture = captures[0];
  const candidates = selectPages({
    domain: company.domain,
    homeUrl: homeCapture?.url ?? `https://${company.domain}/`,
    links: homeCapture?.links ?? [],
    limit: maxPages,
  });

  // One active page request per domain (brief §Execution settings): sequential.
  for (const candidate of candidates) {
    if (captures.length >= maxPages) break;
    if (candidate.role === "home") continue; // already captured above
    await capturePage(candidate);
  }

  const detected = detectFromCaptures({
    companyId: company.companyId,
    pages: pagesForDetection,
    networkRequests,
    now: now(),
  });

  // Every signal resolves to an evidence record (spec: observations in a plan
  // must resolve to evidence).
  const signalEvidence: Evidence[] = detected.signals.map((signal) =>
    newEvidence({
      url: signal.pageUrl ?? `https://${company.domain}/`,
      method: signal.method,
      locator: signal.locator,
      excerpt: excerptOf(signal.excerpt ?? signal.signature),
      limitations:
        signal.integrationStatus === "probable"
          ? ["first-party disclosure may be historical — verify currency"]
          : [],
    }),
  );

  const publicIntegration = derivePublicIntegrationStatus(detected.signals, scanIncomplete);
  const hubspotEvidence: HubSpotEvidence = {
    publicIntegration,
    // Public website evidence can never establish internal CRM adoption —
    // the field stays unknown until a first-party report or an authorized
    // connection says otherwise (brief §What counts as HubSpot evidence).
    internalAdoption: "unknown",
    checkedAt: now().toISOString(),
    note:
      "Public website evidence only — cannot establish internal CRM adoption." +
      (publicIntegration === "not_observed"
        ? " No public HubSpot signature was found; absence of evidence is not evidence of absence."
        : ""),
  };

  const allEvidence = [...evidence, ...signalEvidence];
  await opts.store.savePageCaptures(company.workspaceId, company.companyId, captures);
  await opts.store.saveTechnologySignals(company.workspaceId, company.companyId, detected.signals);
  await opts.store.saveEvidence(company.workspaceId, company.companyId, allEvidence);
  await opts.store.setCompanyHubspotEvidence(company.workspaceId, company.companyId, hubspotEvidence);

  return { captures, signals: detected.signals, evidence: allEvidence, hubspotEvidence };
}
