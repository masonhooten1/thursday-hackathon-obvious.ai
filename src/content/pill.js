// The on-profile pill (spec §What happens on a lookup): idle → busy → result,
// rendered only while the current page is a profile URL. The pure result →
// display mapping is exported for unit tests; the DOM mount is thin and only
// runs in a real page context.

import { parseProfileHandle } from './detect.js';

const IDLE_LABEL = 'Find email';
const BUSY_LABEL = 'Finding email…';

/**
 * Map a normalized lookup result to the pill's one-line display. The popup
 * carries the full message; the pill keeps a short, honest label per class.
 * An undefined result (no listener answered) falls through to the generic
 * failure label rather than blanking the pill.
 *
 * @param {import('../providers/provider.js').LookupResult | undefined | null} result
 * @returns {{ tone: 'found'|'miss'|'error', label: string }}
 */
export function displayFromResult(result) {
  switch (result?.status) {
    case 'found':
      return { tone: 'found', label: result.email };
    case 'not_found':
      return { tone: 'miss', label: 'No email found' };
    default:
      switch (result?.code) {
        case 'no_key':
          return { tone: 'error', label: 'Add your API key in options' };
        case 'rate_limited':
          return { tone: 'error', label: 'Rate limited — retry soon' };
        case 'network':
          return { tone: 'error', label: 'Connection problem' };
        default:
          return { tone: 'error', label: 'Lookup failed' };
      }
  }
}

/**
 * Create the pill in the page. Dependencies are injected (document, sender) so
 * a DOM-backed harness can mount it later without Chrome.
 *
 * @param {Document} doc
 * @param {{ sendMessage: (message: { type: 'find-email', url: string }) => Promise<unknown> }} deps
 */
export function mountPill(doc, { sendMessage }) {
  const pill = doc.createElement('div');
  pill.className = 'lte-pill';
  pill.textContent = IDLE_LABEL;
  pill.setAttribute('role', 'button');

  let busy = false;

  const show = ({ tone, label }) => {
    pill.classList.remove('lte-pill--busy', 'lte-pill--found', 'lte-pill--miss', 'lte-pill--error');
    pill.classList.add(`lte-pill--${tone}`);
    pill.textContent = label;
    busy = false;
  };

  pill.addEventListener('click', () => {
    if (busy) return;

    // Re-validate at click time: a client-side navigation away from the
    // profile must not spend a lookup — the pill removes itself instead.
    if (!parseProfileHandle(doc.location?.href ?? '')) {
      pill.remove();
      return;
    }

    busy = true;
    pill.classList.remove('lte-pill--found', 'lte-pill--miss', 'lte-pill--error');
    pill.classList.add('lte-pill--busy');
    pill.textContent = BUSY_LABEL;

    sendMessage({ type: 'find-email', url: doc.location.href })
      .then((result) => show(displayFromResult(result)))
      .catch(() => show({ tone: 'error', label: 'Lookup failed' }));
  });

  doc.body.append(pill);
}

// Content-script bootstrap: runs in the page (the manifest matches /in/*),
// skipped under node tests where document does not exist.
if (typeof document !== 'undefined') {
  mountPill(document, { sendMessage: (message) => chrome.runtime.sendMessage(message) });
}
