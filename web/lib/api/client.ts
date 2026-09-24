import type { IdentifyResponse } from "./types";
import { MockIdentifyClient } from "./mock-client";

/** One seam between the identify screen and whatever names the plant. */
export interface IdentifyClient {
  identify(image: File, signal?: AbortSignal): Promise<IdentifyResponse>;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Mock mode is the default so the UI ships and demos before the identify API
 * exists. When NEXT_PUBLIC_API_BASE is set at build time (Next.js inlines
 * NEXT_PUBLIC_* into client bundles), the live client takes over.
 */
export function createIdentifyClient(): IdentifyClient {
  return new MockIdentifyClient();
}
