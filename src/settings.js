// Settings shared by the service worker, popup, and options page — a plain
// module with no chrome.* APIs so the rules it encodes stay unit-testable.
// The extension keeps exactly two values in chrome.storage.local: the provider
// choice and the user's API key.

export const DEFAULT_PROVIDER = 'prospeo';

/** @typedef {'prospeo' | 'hunter'} ProviderId */

/** Ordered provider registry — drives the options select and display labels. */
export const PROVIDERS = [
  { id: 'prospeo', label: 'Prospeo' },
  { id: 'hunter', label: 'Hunter' },
];

/**
 * Display label for a known provider id; falls back to the raw id.
 *
 * @param {string} id
 * @returns {string}
 */
export function providerLabel(id) {
  return PROVIDERS.find((provider) => provider.id === id)?.label ?? id;
}

/**
 * Coerce raw chrome.storage values into valid settings: an unknown or missing
 * provider falls back to the default, and the key is trimmed with empty values
 * collapsed to null so stray whitespace never reaches an API.
 *
 * @param {{ provider?: unknown, apiKey?: unknown } | null | undefined} raw
 * @returns {{ provider: ProviderId, apiKey: string | null }}
 */
export function normalizeSettings(raw) {
  const stored = raw?.provider;
  const provider =
    stored === 'prospeo' || stored === 'hunter' ? stored : DEFAULT_PROVIDER;
  const apiKey =
    typeof raw?.apiKey === 'string' && raw.apiKey.trim().length > 0
      ? raw.apiKey.trim()
      : null;
  return { provider, apiKey };
}

/**
 * Key-format sanity check for the options page: non-empty, no whitespace
 * anywhere. Deliberately format-agnostic — provider key shapes are not
 * documented reliably, and a stricter check could reject a valid key. Catches
 * the common failure of a truncated or line-wrapped paste.
 *
 * @param {string} key
 * @returns {string | null} null when the key passes; a short reason otherwise.
 */
export function validateApiKey(key) {
  if (key.trim().length === 0) return 'Enter your API key.';
  if (/\s/.test(key)) return 'API keys contain no spaces — re-copy the key.';
  return null;
}
