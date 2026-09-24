// Popup state machine (spec §What happens on a lookup — popup state model).
// Pure: no chrome.*, no DOM. popup.js dispatches actions and renders the
// resulting state. The model is the spec's eight states plus one: the adapter
// contract's 'provider' error bucket (unexpected HTTP, unreadable response)
// renders in the same error card as network/rate-limited with its own message,
// because the spec requires every adapter failure to land as a distinct,
// actionable message.

import { parseProfileHandle } from '../content/detect.js';
import { DEFAULT_PROVIDER } from '../settings.js';

/**
 * @typedef {'no-key'|'ready'|'invalid-url'|'loading'|'found'|'not-found'|'rate-limited'|'network'|'provider-error'} PopupStateName
 */

/**
 * @typedef {Object} PopupState
 * @property {PopupStateName} name
 * @property {string} url - The form's URL; kept so returning from a result restores the form.
 * @property {string} provider - Normalized provider id the lookup will use.
 * @property {import('../providers/provider.js').LookupResult | null} result - Set on terminal states; carries email/confidence/message.
 */

/**
 * @typedef {{ type: 'init', hasKey: boolean, provider: string, url?: unknown }} InitAction
 * @typedef {{ type: 'url-changed', url: string }} UrlChangedAction
 * @typedef {{ type: 'submit' }} SubmitAction
 * @typedef {{ type: 'result', result: import('../providers/provider.js').LookupResult }} ResultAction
 * @typedef {{ type: 'new-lookup' }} NewLookupAction
 * @typedef {InitAction | UrlChangedAction | SubmitAction | ResultAction | NewLookupAction} PopupAction
 */

/** @type {PopupState} */
export const initialState = {
  name: 'ready',
  url: '',
  provider: DEFAULT_PROVIDER,
  result: null,
};

/**
 * A prefill is shown only when it is a profile URL; anything else starts the
 * form empty rather than landing the user on the invalid-URL state they did
 * not type.
 *
 * @param {unknown} url
 * @returns {string}
 */
function prefill(url) {
  return typeof url === 'string' && parseProfileHandle(url) ? url : '';
}

/**
 * Map one normalized adapter result to the state that displays it.
 *
 * @param {import('../providers/provider.js').LookupResult} result
 * @returns {{ name: PopupStateName, result: import('../providers/provider.js').LookupResult }}
 */
function stateFromResult(result) {
  switch (result.status) {
    case 'found':
      return { name: 'found', result };
    case 'not_found':
      return { name: 'not-found', result };
    default:
      switch (result.code) {
        case 'no_key':
          return { name: 'no-key', result };
        case 'rate_limited':
          return { name: 'rate-limited', result };
        case 'network':
          return { name: 'network', result };
        default:
          return { name: 'provider-error', result };
      }
  }
}

/**
 * @param {PopupState} state
 * @param {PopupAction} action
 * @returns {PopupState}
 */
export function reduce(state, action) {
  switch (action.type) {
    case 'init': {
      return {
        name: action.hasKey ? 'ready' : 'no-key',
        url: prefill(action.url),
        provider: action.provider,
        result: null,
      };
    }

    case 'url-changed': {
      if (state.name !== 'ready' && state.name !== 'invalid-url') return state;
      if (action.url === '') return { ...state, name: 'ready', url: '' };
      return parseProfileHandle(action.url)
        ? { ...state, name: 'ready', url: action.url }
        : { ...state, name: 'invalid-url', url: action.url };
    }

    case 'submit': {
      if (state.name !== 'ready' || !parseProfileHandle(state.url)) return state;
      return { ...state, name: 'loading', result: null };
    }

    case 'result': {
      if (state.name !== 'loading') return state;
      return { ...state, ...stateFromResult(action.result) };
    }

    case 'new-lookup': {
      const settled = !['ready', 'invalid-url', 'loading', 'no-key'].includes(state.name);
      return settled ? { ...state, name: 'ready', result: null } : state;
    }

    default:
      return state;
  }
}
