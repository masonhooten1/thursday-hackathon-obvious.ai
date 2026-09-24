// Prospeo adapter (default provider): POST /enrich-person with the profile
// URL, authenticated via the X-KEY header. Expected response shape —
// { person: { email, email_confidence } } — is pinned as a fixture under
// tests/fixtures; re-pin from a live response the first time a real key runs
// (spec gap [O1]). Adapters never throw for provider-side outcomes.
import { lookupError, lookupFound, lookupInvalidUrl, lookupNotFound } from './provider.js';
import { parseProfileHandle } from '../content/detect.js';

export const DEFAULT_ENDPOINT = 'https://api.prospeo.io/enrich-person';

// Resolved per call so a QA harness can retarget a stub by setting
// globalThis.__PROSPEO_ENDPOINT__ at any time — before or after import.
export function endpoint() {
  return globalThis.__PROSPEO_ENDPOINT__ ?? DEFAULT_ENDPOINT;
}

const PROVIDER = 'prospeo';

/**
 * @param {string} url
 * @param {{ apiKey?: string | null, signal?: AbortSignal }} [options]
 * @returns {Promise<import('./provider.js').LookupResult>}
 */
export async function findEmailByLinkedInUrl(url, { apiKey, signal } = {}) {
  if (!apiKey) return lookupError('no_key', 'Add your Prospeo API key in extension options.');
  if (!parseProfileHandle(url)) return lookupInvalidUrl();

  let res;
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-KEY': apiKey },
      body: JSON.stringify({ linkedin_url: url }),
      signal,
    });
  } catch {
    return lookupError('network', 'Could not reach Prospeo. Check your connection and retry.');
  }

  if (res.status === 429) {
    return lookupError('rate_limited', 'Prospeo rate limit hit — wait a moment and retry.');
  }
  if (res.status === 401 || res.status === 403) {
    return lookupError('no_key', 'Prospeo rejected the API key. Re-check it in options.');
  }
  if (!res.ok) {
    return lookupError('provider', `Prospeo returned an unexpected error (HTTP ${res.status}).`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return lookupError('provider', 'Prospeo returned a response we could not read.');
  }

  const email = data?.person?.email ?? null;
  if (!email) return lookupNotFound(PROVIDER);
  return lookupFound(email, data?.person?.email_confidence ?? null, PROVIDER);
}
