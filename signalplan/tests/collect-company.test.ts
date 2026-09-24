import { describe, expect, it, vi } from "vitest";
import { collectCompany, excerptOf } from "@/workers/collector/collect-company";
import type { CollectorOptions, FetchPageResult } from "@/workers/collector/collect-company";
import type { Evidence, HubSpotEvidence, PageCapture, TechnologySignal } from "@/lib/contracts";
import type { RenderPageResult } from "@/workers/collector/render";
import { CONSENT_GATED_HTML, EMBEDDED_LOADER_HTML, PROMPT_INJECTION_HTML } from "@/fixtures/collector";

class MemoryStore {
  captures: PageCapture[] = [];
  signals: TechnologySignal[] = [];
  evidence: Evidence[] = [];
  hubspot: HubSpotEvidence | null = null;

  store(): CollectorOptions["store"] {
    return {
      savePageCaptures: async (_w, _c, captures) => {
        this.captures.push(...captures);
      },
      saveTechnologySignals: async (_w, _c, signals) => {
        this.signals.push(...signals);
      },
      saveEvidence: async (_w, _c, evidence) => {
        this.evidence.push(...evidence);
      },
      setCompanyHubspotEvidence: async (_w, _c, hubspotEvidence) => {
        this.hubspot = hubspotEvidence;
      },
    };
  }
}

const COMPANY = { companyId: "company-1", domain: "example.com", workspaceId: "ws-1" };

function options(store: MemoryStore, overrides: Partial<CollectorOptions> = {}): CollectorOptions {
  return {
    fetchPage: async () => ({ finalUrl: "https://example.com/", httpStatus: 200, body: EMBEDDED_LOADER_HTML }),
    store: store.store(),
    now: () => new Date("2026-09-24T12:00:00.000Z"),
    ...overrides,
  };
}

describe("collectCompany", () => {
  it("produces bounded evidence, signals, and a correctly labeled status from one page (check 1)", async () => {
    const store = new MemoryStore();
    const result = await collectCompany(COMPANY, options(store, { maxPages: 3 }));

    expect(result.captures.length).toBeLessThanOrEqual(3);
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
    expect(result.hubspotEvidence.publicIntegration).toBe("observed");
    // Internal CRM adoption is never concluded from a public scan.
    expect(result.hubspotEvidence.internalAdoption).toBe("unknown");
    expect(result.hubspotEvidence.note).toMatch(/cannot establish internal CRM adoption/i);
    // Every signal resolves to an evidence record.
    for (const signal of result.signals) {
      expect(result.evidence.some((e) => e.locator === signal.locator)).toBe(true);
    }
    // Evidence carries capturedAt and the persisted store received everything.
    expect(result.evidence.every((e) => e.capturedAt === "2026-09-24T12:00:00.000Z")).toBe(true);
    expect(store.captures.length).toBe(result.captures.length);
    expect(store.signals.length).toBe(result.signals.length);
    expect(store.hubspot).not.toBeNull();
  });

  it("a failed page fetch is a coverage event — scan_incomplete, never not_observed (check 2)", async () => {
    const store = new MemoryStore();
    const result = await collectCompany(
      COMPANY,
      options(store, {
        fetchPage: async (url) => {
          if (url.endsWith("/")) {
            return {
              finalUrl: url,
              httpStatus: 200,
              body: '<html><body><a href="https://example.com/pricing">pricing</a><a href="https://example.com/contact">contact</a></body></html>',
            };
          }
          throw new Error("connection reset");
        },
        maxPages: 3,
      }),
    );
    expect(result.captures.some((c) => c.error === "capture failed")).toBe(true);
    expect(
      result.captures.some((c) => c.limitations.some((l) => l.includes("connection reset"))),
    ).toBe(true);
    expect(result.hubspotEvidence.publicIntegration).toBe("scan_incomplete");
  });

  it("a blocked destination propagates — it is a company-level condition, not a page limitation", async () => {
    const store = new MemoryStore();
    const blocked = new Error("blocked");
    blocked.name = "BlockedDestinationError";
    await expect(
      collectCompany(COMPANY, options(store, { fetchPage: async () => Promise.reject(blocked), maxPages: 3 })),
    ).rejects.toMatchObject({ name: "BlockedDestinationError" });
  });

  it("renders demo pages selectively and upgrades the capture to rendered_dom with network evidence (check 2)", async () => {
    const store = new MemoryStore();
    const fetchPage = vi.fn(async (url: string): Promise<FetchPageResult> => {
      const html = url.endsWith("/demo")
        ? CONSENT_GATED_HTML.replace(
            "</body>",
            '<script src="https://js.hs-scripts.com/44556677.js"></script></body>',
          )
        : '<html><body><a href="https://example.com/demo">demo</a></body></html>';
      return { finalUrl: url, httpStatus: 200, body: html };
    });
    const renderPage = vi.fn(
      async (): Promise<RenderPageResult> => ({
        url: "https://example.com/demo",
        finalUrl: "https://example.com/demo",
        httpStatus: 200,
        html: '<html><body><script src="https://js.hs-scripts.com/44556677.js"></script></body></html>',
        requests: [{ url: "https://js.hs-scripts.com/44556677.js", method: "GET" }],
        observations: ["playwright: consent-banner observed"],
      }),
    );

    const result = await collectCompany(
      COMPANY,
      options(store, { fetchPage, renderPage: { render: renderPage }, maxPages: 2 }),
    );

    expect(renderPage).toHaveBeenCalledTimes(1);
    const rendered = result.captures.find((c) => c.method === "rendered_dom");
    expect(rendered).toBeDefined();
    expect(rendered?.limitations.some((l) => l.includes("rendered pass"))).toBe(true);
    expect(result.signals.some((s) => s.method === "rendered_dom")).toBe(true);
    expect(result.signals.some((s) => s.method === "network")).toBe(true);
    expect(result.hubspotEvidence.publicIntegration).toBe("observed");
  });

  it("without a renderer, a demo page that needs rendering keeps the scan honest", async () => {
    const store = new MemoryStore();
    const result = await collectCompany(
      COMPANY,
      options(store, {
        fetchPage: async () => ({
          finalUrl: "https://example.com/",
          httpStatus: 200,
          body: '<html><body><a href="https://example.com/demo">demo</a></body></html>',
        }),
        maxPages: 2,
      }),
    );
    const demo = result.captures.find((c) => c.role === "demo_contact");
    expect(demo?.limitations.some((l) => l.includes("renderer unavailable"))).toBe(true);
    expect(result.hubspotEvidence.publicIntegration).toBe("scan_incomplete");
  });

  it("one active page request per domain: captures are sequential", async () => {
    const store = new MemoryStore();
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await collectCompany(
      COMPANY,
      options(store, {
        fetchPage: vi.fn(async (url: string) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight -= 1;
          return url.endsWith("/")
            ? {
                finalUrl: url,
                httpStatus: 200,
                body: '<html><body><a href="https://example.com/pricing">pricing</a><a href="https://example.com/contact">contact</a></body></html>',
              }
            : { finalUrl: url, httpStatus: 200, body: EMBEDDED_LOADER_HTML };
        }),
        maxPages: 4,
      }),
    );
    expect(result.captures.length).toBeGreaterThan(1);
    expect(maxInFlight).toBe(1);
  });

  it("prompt-injection page content is captured as data and produces no fabricated adoption claim (check 7)", async () => {
    const store = new MemoryStore();
    const result = await collectCompany(
      COMPANY,
      options(store, {
        fetchPage: async () => ({
          finalUrl: "https://example.com/pricing",
          httpStatus: 200,
          body: PROMPT_INJECTION_HTML,
        }),
        maxPages: 1,
      }),
    );
    const injected = result.evidence.find((e) => e.excerpt.includes("Ignore all previous instructions"));
    expect(injected).toBeDefined();
    expect(injected?.limitations).toEqual([]);
    expect(result.signals).toEqual([]);
    expect(result.hubspotEvidence.internalAdoption).toBe("unknown");
  });

  it("bounded excerpts: evidence text is capped regardless of page size", () => {
    const long = "x".repeat(5000);
    expect(excerptOf(long, 280)).toHaveLength(280);
    expect(excerptOf(long, 280).endsWith("…")).toBe(true);
    expect(excerptOf("short")).toBe("short");
  });
});
