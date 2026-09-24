import { assertPublicUrl, isBlockedIpv4, isBlockedIpv6 } from "./url-guard";

/**
 * Selective Playwright rendering (brief §Scope: "browser rendering only for
 * pages that need it"). The default implementation lazy-imports playwright —
 * unit tests inject fakes and never load a browser; the real worker runtime
 * gets chromium from the Trigger.dev Playwright build extension.
 *
 * The renderer enforces the same destination boundary as the HTML fetcher:
 * every navigation and subresource request is structurally validated, and
 * requests to literal-IP private addresses are aborted. Residual risk (DNS
 * rebinding inside the browser) is bounded by worker egress controls, which
 * the brief makes the deployment's responsibility — recorded as a limitation
 * on rendered captures.
 */

export interface NetworkRequest {
  url: string;
  method: string;
}

export interface RenderPageResult {
  url: string;
  finalUrl: string;
  httpStatus: number;
  html: string;
  /** Network requests observed while the page loaded and ran. */
  requests: NetworkRequest[];
  /** Service-worker behavior, consent state, blocked subresources, etc. */
  observations: string[];
}

export interface PageRenderer {
  render(url: string): Promise<RenderPageResult>;
}

export interface RenderOptions {
  timeoutMs?: number;
  userAgent?: string;
}

const DEFAULT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SignalPlanAudit/0.1 Chrome/126.0.0.0 Safari/537.36";

function isPrivateLiteralHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (isBlockedIpv4(h) || isBlockedIpv6(h)) return true;
  return h.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
}

export function createPlaywrightRenderer(options: RenderOptions = {}): PageRenderer {
  return {
    async render(url: string): Promise<RenderPageResult> {
      // Structural validation before any browser work; a blocked destination
      // throws the same error class as the HTML path so the company state
      // mapping stays identical.
      assertPublicUrl(url);
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ userAgent: options.userAgent ?? DEFAULT_UA });
        const page = await context.newPage();

        const requests: NetworkRequest[] = [];
        const observations: string[] = [];

        // Destination boundary for subresources: abort private/literal-IP and
        // non-http(s) requests before they leave the worker.
        await page.route("**/*", (route) => {
          const request = route.request();
          const requestUrl = request.url();
          try {
            const parsed = new URL(requestUrl);
            if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
              observations.push(`blocked non-http subrequest ${parsed.protocol}`);
              void route.abort();
              return;
            }
            if (isPrivateLiteralHost(parsed.hostname)) {
              observations.push(`blocked private-address subrequest to ${parsed.hostname}`);
              void route.abort();
              return;
            }
            if (request.isNavigationRequest() || request.resourceType() === "script") {
              requests.push({ url: requestUrl, method: request.method() });
            }
            void route.continue();
          } catch {
            void route.abort();
          }
        });

        // Service workers register on the browser context in Playwright.
        page.context().on("serviceworker", () => {
          observations.push("page uses a service worker — network capture may miss its requests");
        });

        const response = await page.goto(url, {
          waitUntil: "networkidle",
          timeout: options.timeoutMs ?? 30_000,
        });
        const html = await page.content();
        return {
          url,
          finalUrl: page.url(),
          httpStatus: response?.status() ?? 0,
          html,
          requests,
          observations,
        };
      } finally {
        await browser.close();
      }
    },
  };
}
