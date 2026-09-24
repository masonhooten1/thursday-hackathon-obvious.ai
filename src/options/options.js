// Options shell (spec §What we build): provider select + API key input,
// persisted to chrome.storage.local. The key is written only to storage —
// transmission to its provider's origin happens exclusively inside the
// adapters. The rules this page enforces (validation, defaults, labels) live
// in settings.js where they are unit-tested.

import { PROVIDERS, normalizeSettings, providerLabel, validateApiKey } from '../settings.js';

const els = {
  provider: document.querySelector('#select-provider'),
  key: document.querySelector('#input-key'),
  keyError: document.querySelector('#key-error'),
  save: document.querySelector('#btn-save'),
  savedNote: document.querySelector('#saved-note'),
};

function setKeyError(message) {
  els.keyError.textContent = message ?? '';
  els.keyError.hidden = message === null;
  els.save.disabled = message !== null;
}

for (const { id, label } of PROVIDERS) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = label;
  els.provider.append(option);
}

// One key slot: switching providers clears the field, because the displayed
// key belongs to the previous provider and must not be saved under the new one.
els.provider.addEventListener('change', () => {
  els.key.value = '';
  setKeyError(validateApiKey(''));
});

els.key.addEventListener('input', () => setKeyError(validateApiKey(els.key.value)));

els.save.addEventListener('click', async () => {
  const error = validateApiKey(els.key.value);
  setKeyError(error);
  if (error !== null) return;

  await chrome.storage.local.set({
    provider: els.provider.value,
    apiKey: els.key.value.trim(),
  });
  els.savedNote.textContent = `Saved — lookups will use ${providerLabel(els.provider.value)}.`;
});

// chrome.storage.local persists across service-worker restarts, so a saved
// key is still here the next time this page opens (spec V4).
const settings = normalizeSettings(await chrome.storage.local.get(['provider', 'apiKey']));
els.provider.value = settings.provider;
els.key.value = settings.apiKey ?? '';
setKeyError(validateApiKey(els.key.value));
if (settings.apiKey !== null) {
  els.savedNote.textContent = `Current provider: ${providerLabel(settings.provider)}.`;
}
