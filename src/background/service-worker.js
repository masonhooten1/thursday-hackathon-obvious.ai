// Service worker (MV3, module): owns the chrome.* wiring — storage reads and
// the message port — and nothing else. All routing logic lives in router.js so
// it stays testable without Chrome. This file never logs: the API key and
// profile URLs must not reach any console.

import { isFindEmailMessage, routeMessage } from './router.js';
import { findEmailByLinkedInUrl as prospeoAdapter } from '../providers/prospeo.js';
import { findEmailByLinkedInUrl as hunterAdapter } from '../providers/hunter.js';
import { lookupError } from '../providers/provider.js';

const ADAPTERS = { prospeo: prospeoAdapter, hunter: hunterAdapter };

function readSettings() {
  return chrome.storage.local.get(['provider', 'apiKey']);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isFindEmailMessage(message)) return false; // Not ours — decline the port.

  routeMessage(message, { getSettings: readSettings, adapters: ADAPTERS })
    .then((result) => {
      // routeMessage returns null only for non-owned messages, which the
      // guard above already filtered out — so a result here is always sent.
      if (result !== null) sendResponse(result);
    })
    .catch(() => {
      // A storage failure must not leave the sender hanging on a response
      // that never arrives; the static message carries no key or URL material.
      sendResponse(
        lookupError('provider', 'The lookup could not start. Reload the extension and retry.'),
      );
    });

  return true; // Keep the port open for the async sendResponse.
});
