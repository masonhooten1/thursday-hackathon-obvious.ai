// Hunter adapter (second provider): GET /v2/email-finder with the handle
// derived from the profile URL and api_key as a query param (Hunter's
// documented auth). Expected response shape — { data: { email, score } } — is
// pinned as a fixture under tests/fixtures; re-pin from a live response the
// first time a real key runs. Adapters never throw for provider-side outcomes.
import { lookupError, lookupFound, lookupInvalidUrl, lookupNotFound } from './provider.js';
import { parseProfileHandle } from '../content/detect.js';

export const DEFAULT_ENDPOINT = 'https://api.hunter.io/v2/email-finder';

// Same override pattern as the Prospeo adapter: a QA harness sets
// globalThis.__HUNTER_ENDPOINT__ to point this at a stub, any time.
export function endpoint() {
  return globalThis.__HUNTER_ENDPOINT__ ?? DEFAULT_ENDPOINT;
}

const PROVIDER = 'hunter';

/**
 * @param {string} url
 * @param {{ apiKey?: string | null, signal?: AbortSignal }} [options]
 * @returns {Promise<import('./provider.js').LookupResult>}
 */
export async function findEmailByLinkedInUrl(url, { apiKey, signal } = {}) {
  if (!apiKey) return lookupError('no_key', 'Add your Hunter API key in extension options.');

  const handle = parseProfileHandle(url);
  if (!handle) return lookupInvalidUrl();

  const params = new URLSearchParams({ api_key: apiKey, linkedin_handle: handle });

  let res;
  try {
    res = await fetch(`${endpoint()}?${params}`, { method: 'GET', signal });
  } catch {
    return lookupError('network', 'Could not reach Hunter. Check your connection and retry.');
  }

  if (res.status === 429) {
    return lookupError('rate_limited', 'Hunter rate limit hit — wait a moment and retry.');
  }
  if (res.status === 401 || res.status === 403) {
    return lookupError('no_key', 'Hunter rejected the API key. Re-check it in options.');
  }
  if (!res.ok) {
    return lookupError('provider', `Hunter returned an unexpected error (HTTP ${res.status}).`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return lookupError('provider', 'Hunter returned a response we could not read.');
  }

  // Hunter's v2 envelope wraps results in `data`; a miss can arrive as either
  // `data: null` or a `data` object with a null email — both normalize below.
  const email = data?.data?.email ?? null;
  if (!email) return lookupNotFound(PROVIDER);
  return lookupFound(email, data?.data?.score ?? null, PROVIDER);
}
