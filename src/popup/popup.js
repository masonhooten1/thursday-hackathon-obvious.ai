// Popup shell (spec §Popup behavior): reads chrome state, dispatches reducer
// actions, renders. All transition logic lives in state.js; this file holds
// only the chrome.* calls and DOM writes.

import { initialState, reduce } from './state.js';
import { normalizeSettings, providerLabel } from '../settings.js';
import { parseProfileHandle } from '../content/detect.js';
import { lookupError } from '../providers/provider.js';

const els = {
  sections: Array.from(document.querySelectorAll('[data-section]')),
  noKeyMessage: document.querySelector('#no-key-message'),
  openOptions: document.querySelector('#btn-open-options'),
  input: document.querySelector('#input-url'),
  invalidUrl: document.querySelector('#invalid-url-message'),
  find: document.querySelector('#btn-find'),
  loadingProvider: document.querySelector('#loading-provider'),
  foundEmail: document.querySelector('#found-email'),
  foundMeta: document.querySelector('#found-meta'),
  copy: document.querySelector('#btn-copy'),
  newLookup: document.querySelector('#btn-new-lookup'),
  errorMessage: document.querySelector('#error-message'),
  retryNotFound: document.querySelector('#btn-retry-not-found'),
  retryError: document.querySelector('#btn-retry-error'),
};

// state.name → the section that renders it. invalid-url reuses the ready form
// with the inline error visible and the button disabled.
const SECTION_FOR = {
  'no-key': 'no-key',
  ready: 'ready',
  'invalid-url': 'ready',
  loading: 'loading',
  found: 'found',
  'not-found': 'not-found',
  'rate-limited': 'error',
  network: 'error',
  'provider-error': 'error',
};

let state = initialState;

function dispatch(action) {
  state = reduce(state, action);
  render();
}

function render() {
  const sectionName = SECTION_FOR[state.name] ?? 'ready';
  for (const section of els.sections) {
    section.hidden = section.dataset.section !== sectionName;
  }

  // No key: the adapter's key-rejection message wins over the storage-empty copy.
  els.noKeyMessage.textContent =
    state.result?.message ??
    `No API key yet. Add your ${providerLabel(state.provider)} key to start.`;

  // Ready / invalid-URL form.
  if (els.input.value !== state.url) els.input.value = state.url;
  els.invalidUrl.hidden = state.name !== 'invalid-url';
  els.find.disabled = state.name !== 'ready' || state.url === '';

  // Loading: name the provider so a stall is attributable.
  els.loadingProvider.textContent = `${providerLabel(state.provider)} — searching`;

  // Found: email, source, confidence.
  els.foundEmail.textContent = state.result?.email ?? '';
  const confidence = state.result?.confidence;
  const provider = providerLabel(state.result?.provider ?? state.provider);
  els.foundMeta.textContent =
    confidence === null || confidence === undefined
      ? provider
      : `${provider} · confidence ${confidence}`;

  // Error card: the adapter's message names the cause.
  els.errorMessage.textContent = state.result?.message ?? 'The lookup failed.';
}

async function performLookup() {
  dispatch({ type: 'submit' });

  let result;
  try {
    result = await chrome.runtime.sendMessage({ type: 'find-email', url: state.url });
  } catch {
    // sendMessage rejects when no listener answers (e.g. the extension was
    // reloaded mid-lookup) — surface it instead of hanging in loading.
    result = lookupError(
      'provider',
      'The extension could not complete the lookup. Reload it and retry.',
    );
  }
  if (result === undefined) {
    result = lookupError('provider', 'The extension did not answer. Reload it and retry.');
  }

  dispatch({ type: 'result', result });
}

function wireEvents() {
  els.input.addEventListener('input', () => {
    dispatch({ type: 'url-changed', url: els.input.value });
  });

  els.find.addEventListener('click', () => {
    void performLookup();
  });

  els.openOptions.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });

  for (const button of [els.retryNotFound, els.retryError, els.newLookup]) {
    button.addEventListener('click', () => dispatch({ type: 'new-lookup' }));
  }

  els.copy.addEventListener('click', async () => {
    if (state.name !== 'found') return;
    try {
      await navigator.clipboard.writeText(state.result.email);
      els.copy.textContent = 'Copied ✓';
    } catch {
      els.copy.textContent = 'Copy failed — select the email text';
    }
    setTimeout(() => {
      els.copy.textContent = 'Copy email';
    }, 1500);
  });
}

async function init() {
  wireEvents();

  // activeTab (granted by opening the popup) exposes the active tab's URL —
  // prefill only when it is a profile URL; the reducer re-validates.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = normalizeSettings(
    await chrome.storage.local.get(['provider', 'apiKey']),
  );

  dispatch({
    type: 'init',
    hasKey: settings.apiKey !== null,
    provider: settings.provider,
    url: typeof tab?.url === 'string' ? tab.url : '',
  });
}

void init();
