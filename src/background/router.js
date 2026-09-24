// Message router for find-email lookups (spec §What we build): the pure core
// of the service worker. chrome.* I/O is injected via deps, so every routing
// rule runs in node tests. The router itself performs no network calls and
// contains no logging — the API key and profile URLs are never logged
// anywhere in the extension.

import { lookupError, lookupInvalidUrl } from '../providers/provider.js';
import { parseProfileHandle } from '../content/detect.js';
import { normalizeSettings } from '../settings.js';

/**
 * @typedef {(url: string, options: { apiKey?: string | null, signal?: AbortSignal }) => Promise<import('../providers/provider.js').LookupResult>} LookupAdapter
 */

/**
 * Whether a runtime message is one this extension routes. Exported so the
 * service worker can decline foreign messages synchronously (returning false
 * from the listener) instead of holding their port open.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isFindEmailMessage(message) {
  if (typeof message !== 'object' || message === null) return false;
  const { type, url } = /** @type {{ type?: unknown, url?: unknown }} */ (message);
  return type === 'find-email' && typeof url === 'string';
}

/**
 * Route one runtime message to the adapter named by the saved provider
 * setting. Resolves to null for messages this extension does not own (the
 * caller must not respond to those); every owned message resolves to a
 * LookupResult — the router rejects only if the injected storage read rejects.
 *
 * An unparseable URL is rejected before storage is read or an adapter runs,
 * so a malformed message never spends a lookup credit.
 *
 * @param {unknown} message
 * @param {{ getSettings: () => Promise<unknown>, adapters: Record<string, LookupAdapter> }} deps
 * @returns {Promise<import('../providers/provider.js').LookupResult | null>}
 */
export async function routeMessage(message, { getSettings, adapters }) {
  if (!isFindEmailMessage(message)) return null;
  if (!parseProfileHandle(message.url)) return lookupInvalidUrl();

  const settings = normalizeSettings(await getSettings());
  const adapter = adapters[settings.provider];
  if (!adapter) {
    // Defensive: normalizeSettings only emits prospeo | hunter, so reaching
    // this means the adapter registry was wired wrong.
    return lookupError('provider', 'No adapter for the selected provider. Reload the extension.');
  }
  return adapter(message.url, { apiKey: settings.apiKey });
}
