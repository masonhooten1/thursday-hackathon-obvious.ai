import "server-only";

/**
 * Playwright print-to-PDF for the fixed two-page template (brief §Stack:
 * "Playwright inside the background worker for selected page rendering and
 * PDF export"). The browser is injectable so tests can run the real chromium
 * while unit tests stub it; the function renders the exact HTML it is given —
 * callers pass template output only, never raw prospect text.
 */

export type PdfBytes = Uint8Array;

export interface PrintBrowser {
  newPage: () => Promise<{
    setContent: (html: string, opts?: { waitUntil?: string }) => Promise<void>;
    pdf: (opts?: { format?: string; printBackground?: boolean }) => Promise<Buffer>;
    close: () => Promise<void>;
  }>;
  close: () => Promise<void>;
}

export type PrintBrowserFactory = () => Promise<PrintBrowser>;

async function defaultChromiumFactory(): Promise<PrintBrowser> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  return browser as unknown as PrintBrowser;
}

export async function printHtmlToPdf(
  html: string,
  newBrowser: PrintBrowserFactory = defaultChromiumFactory,
): Promise<PdfBytes> {
  const browser = await newBrowser();
  try {
    const page = await browser.newPage();
    try {
      // Network idle is pointless here — the template references no external
      // resources by design (no webfonts, no images, no prospect URLs).
      await page.setContent(html, { waitUntil: "load" });
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      return new Uint8Array(pdf);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
