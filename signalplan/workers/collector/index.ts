import "server-only";
import { excerptOf } from "./collect-company";
import type {
  CollectorOptions,
  FetchPage,
  FetchPageResult,
} from "./collect-company";
import { PostgresCollectorStore } from "./store";
import { guardedFetch } from "./url-guard";
import { createPlaywrightRenderer } from "./render";

export { collectCompany } from "./collect-company";
export type {
  CollectorStore,
  CollectorCompany,
  CollectorResult,
  FetchPage,
  FetchPageResult,
  SnapshotStore,
} from "./collect-company";
export { PostgresCollectorStore } from "./store";
export { createPlaywrightRenderer } from "./render";
export type { PageRenderer, RenderPageResult, NetworkRequest } from "./render";
export { guardedFetch, assertPublicUrl, assertPublicAddress, BlockedDestinationError } from "./url-guard";
export { selectPages, classifyRole, isFirstParty, normalizePageUrl } from "./page-selection";
export { detectFromCaptures, derivePublicIntegrationStatus, portalIdFromLoaderUrl } from "./detector";
export { excerptOf };

/**
 * Production HTML fetch pass — the SSRF guard with its default DNS resolver,
 * bounded redirects, and timeouts (brief §Practical safeguards).
 */
export function defaultFetchPage(): FetchPage {
  return async (url: string): Promise<FetchPageResult> => {
    const { response, finalUrl } = await guardedFetch(url);
    const body = await response.text();
    return { finalUrl, httpStatus: response.status, body };
  };
}

/**
 * Production wiring: guarded HTML fetch, Playwright renderer (lazy — chromium
 * comes from the Trigger.dev Playwright build extension in worker builds),
 * Postgres persistence. Snapshots are not yet stored: Supabase Storage
 * credentials are a deployment step, so snapshotRef stays unset and captures
 * carry the "snapshot storage unavailable" limitation — excerpt-only evidence,
 * never a fabricated reference.
 */
export function defaultCollectorOptions(): Omit<CollectorOptions, "store"> & { store: PostgresCollectorStore } {
  return {
    fetchPage: defaultFetchPage(),
    renderPage: createPlaywrightRenderer(),
    store: new PostgresCollectorStore(),
  };
}
