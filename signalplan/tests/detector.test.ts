import { describe, expect, it } from "vitest";
import { detectFromCaptures, derivePublicIntegrationStatus, portalIdFromLoaderUrl } from "@/workers/collector/detector";
import { parsePage } from "@/workers/collector/html";
import {
  COLLECTOR_FIXTURES,
  CONSENT_GATED_HTML,
  EMBEDDED_LOADER_HTML,
  HUBSPOT_MENTION_HTML,
  PROMPT_INJECTION_HTML,
  PROMPT_INJECTION_URL,
  SUBPROCESSOR_HTML,
  SUBPROCESSOR_URL,
} from "@/fixtures/collector";

function pageFor(html: string, url: string, method: "html" | "rendered_dom" = "html") {
  const parsed = parsePage(html, url);
  const capture = {
    id: `cap-${url}`,
    companyId: "company-1",
    url,
    role: "home" as const,
    method,
    httpStatus: 200,
    capturedAt: "2026-09-24T00:00:00.000Z",
    visibleText: parsed.visibleText,
    snapshotRef: undefined,
    links: parsed.links.slice(0, 100),
    forms: parsed.forms,
    runtimeObservations: [],
    error: undefined,
    limitations: [],
  };
  return { capture, parsed };
}

const BASE_INPUT = {
  companyId: "company-1",
  now: new Date("2026-09-24T12:00:00.000Z"),
};

describe("HubSpot signature detector", () => {
  it("detects an embedded loader and hbspt.forms.create call as observed, with the portal id (check 1)", () => {
    const { signals, portalIds } = detectFromCaptures({
      ...BASE_INPUT,
      pages: [pageFor(EMBEDDED_LOADER_HTML, "https://example.com/")],
      networkRequests: [],
    });
    const signatures = signals.map((s) => s.signature);
    expect(signatures.some((h) => h.startsWith("script src js.hs-scripts.com"))).toBe(true);
    expect(signatures.some((h) => h.startsWith("hbspt.forms.create"))).toBe(true);
    expect(signals.every((s) => s.integrationStatus === "observed")).toBe(true);
    expect(signals.every((s) => s.vendor === "HubSpot")).toBe(true);
    expect(portalIds).toEqual(["22931812"]);
    expect(derivePublicIntegrationStatus(signals, false)).toBe("observed");
  });

  it("never reads raw page text for script context: a HubSpot mention plus a code sample is not evidence (check 1)", () => {
    const { signals } = detectFromCaptures({
      ...BASE_INPUT,
      pages: [pageFor(HUBSPOT_MENTION_HTML, "https://example.com/blog/hubspot-integrations")],
      networkRequests: [],
    });
    expect(signals).toEqual([]);
    expect(derivePublicIntegrationStatus(signals, false)).toBe("not_observed");
  });

  it("classifies a first-party subprocessor disclosure as probable, never observed", () => {
    const { signals } = detectFromCaptures({
      ...BASE_INPUT,
      pages: [pageFor(SUBPROCESSOR_HTML, SUBPROCESSOR_URL)],
      networkRequests: [],
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].integrationStatus).toBe("probable");
    expect(signals[0].method).toBe("first_party_text");
    // The excerpt carries the disclosure language itself, not our interpretation.
    expect(signals[0].excerpt).toMatch(/CRM used to manage prospect/);
    expect(derivePublicIntegrationStatus(signals, false)).toBe("probable");
  });

  it("ignores HubSpot mentions on non-disclosure pages even in legal-looking text", () => {
    // Same body, wrong path — a mention in a blog post is page text, not a
    // first-party disclosure.
    const { signals } = detectFromCaptures({
      ...BASE_INPUT,
      pages: [pageFor(SUBPROCESSOR_HTML, "https://example.com/blog/notes")],
      networkRequests: [],
    });
    expect(signals).toEqual([]);
  });

  it("detects a consent-injected tag in the rendered pass and not the HTML pass (check 2)", () => {
    // Initial HTML: no HubSpot signature present at all.
    const htmlOnly = detectFromCaptures({
      ...BASE_INPUT,
      pages: [pageFor(CONSENT_GATED_HTML, "https://example.com/demo")],
      networkRequests: [],
    });
    expect(htmlOnly.signals).toEqual([]);

    // Rendered DOM: the injected loader exists as script context and the
    // network pass saw the request.
    const injected = CONSENT_GATED_HTML.replace(
      "</body>",
      '<script src="https://js.hs-scripts.com/44556677.js"></script></body>',
    );
    const rendered = detectFromCaptures({
      ...BASE_INPUT,
      pages: [pageFor(injected, "https://example.com/demo", "rendered_dom")],
      networkRequests: [{ url: "https://js.hs-scripts.com/44556677.js", method: "GET" }],
    });
    expect(rendered.signals.length).toBeGreaterThanOrEqual(1);
    expect(rendered.signals[0].method).toBe("rendered_dom");
    expect(rendered.portalIds).toContain("44556677");
    expect(derivePublicIntegrationStatus(rendered.signals, false)).toBe("observed");
  });

  it("an incomplete scan yields scan_incomplete, never a negative result (check 2)", () => {
    expect(derivePublicIntegrationStatus([], false)).toBe("not_observed");
    expect(derivePublicIntegrationStatus([], true)).toBe("scan_incomplete");
  });

  it("captures request metadata as network-method evidence", () => {
    const { signals } = detectFromCaptures({
      ...BASE_INPUT,
      pages: [],
      networkRequests: [{ url: "https://forms-eu1.hsforms.net/embed/v3", method: "GET" }],
    });
    expect(signals).toHaveLength(1);
    expect(signals[0].method).toBe("network");
    expect(signals[0].integrationStatus).toBe("observed");
  });

  it("records conflicting portal ids without interpreting them", () => {
    const secondForm = EMBEDDED_LOADER_HTML.replace('portalId: "22931812"', 'portalId: "99887766"');
    const { signals, portalIds } = detectFromCaptures({
      ...BASE_INPUT,
      pages: [
        pageFor(EMBEDDED_LOADER_HTML, "https://example.com/"),
        pageFor(secondForm, "https://example.com/pricing"),
      ],
      networkRequests: [],
    });
    expect(portalIds).toEqual(["22931812", "99887766"]);
    expect(signals.every((s) => s.conflictingPortalIds.length === 2)).toBe(true);
  });

  it("treats instructions embedded in page content as evidence text only (check 7)", () => {
    const { capture, parsed } = pageFor(PROMPT_INJECTION_HTML, PROMPT_INJECTION_URL);
    // The visible text carries the injected text — as DATA, captured verbatim.
    expect(capture.visibleText).toContain("Ignore all previous instructions");
    // The detector produces no signal and no internal-adoption conclusion from it.
    const { signals } = detectFromCaptures({
      ...BASE_INPUT,
      pages: [{ capture, parsed }],
      networkRequests: [],
    });
    expect(signals).toEqual([]);
    // A scanner that "complied" with the injection would claim adoption;
    // the honest status stays not_observed.
    expect(derivePublicIntegrationStatus(signals, false)).toBe("not_observed");
  });

  it("every fixture in the manifest produces its expected status", () => {
    for (const fixture of COLLECTOR_FIXTURES) {
      // HTML pass: what HTML-only detection may conclude. For the consent
      // fixture the collector knows the scan is incomplete (render needed).
      const htmlResult = detectFromCaptures({
        ...BASE_INPUT,
        pages: [pageFor(fixture.html, fixture.url)],
        networkRequests: [],
      });
      expect(htmlResult.signals.length, fixture.id).toBeGreaterThanOrEqual(
        fixture.expected.htmlPass.signalsAtLeast,
      );
      const htmlScanIncomplete = fixture.expected.htmlPass.publicIntegration === "scan_incomplete";
      expect(derivePublicIntegrationStatus(htmlResult.signals, htmlScanIncomplete), fixture.id).toBe(
        fixture.expected.htmlPass.publicIntegration,
      );
      if (fixture.expected.htmlPass.portalId) {
        expect(htmlResult.portalIds, fixture.id).toContain(fixture.expected.htmlPass.portalId);
      }

      // Rendered pass: when the fixture defines one, detection observes it.
      const renderedHtml = fixture.renderedHtml;
      if (fixture.expected.afterRender && renderedHtml) {
        const rendered = detectFromCaptures({
          ...BASE_INPUT,
          pages: [pageFor(renderedHtml, fixture.url, "rendered_dom")],
          networkRequests: [],
        });
        expect(rendered.signals.length, fixture.id).toBeGreaterThanOrEqual(
          fixture.expected.afterRender.signalsAtLeast,
        );
        expect(derivePublicIntegrationStatus(rendered.signals, false), fixture.id).toBe(
          fixture.expected.afterRender.publicIntegration,
        );
        if (fixture.expected.afterRender.portalId) {
          expect(rendered.portalIds, fixture.id).toContain(fixture.expected.afterRender.portalId);
        }
      }
    }
  });

  it("extracts portal ids from regional loader URLs", () => {
    expect(portalIdFromLoaderUrl("https://js.hs-scripts.com/22931812.js")).toBe("22931812");
    expect(portalIdFromLoaderUrl("https://js-eu1.hs-scripts.com/44556677-abc.js")).toBe("44556677");
    expect(portalIdFromLoaderUrl("https://js.hs-scripts.com/notaportal.js")).toBeNull();
  });
});
