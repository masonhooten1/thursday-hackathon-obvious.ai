import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER, initialState, reduce } from '../../src/popup/state.js';

const PROFILE_URL = 'https://www.linkedin.com/in/roger-sterling';
const EMAIL_RESULT = {
  status: 'found',
  email: 'r.sterling@sterlingcooper.com',
  confidence: 92,
  provider: 'prospeo',
};

function readyWith(url) {
  return reduce(initialState, { type: 'init', hasKey: true, provider: 'prospeo', url });
}

describe('init', () => {
  it('lands on no-key without a key', () => {
    const state = reduce(initialState, {
      type: 'init',
      hasKey: false,
      provider: 'prospeo',
      url: PROFILE_URL,
    });

    expect(state).toEqual({ name: 'no-key', url: PROFILE_URL, provider: 'prospeo', result: null });
  });

  it('prefills a valid profile URL', () => {
    expect(readyWith(PROFILE_URL)).toEqual({
      name: 'ready',
      url: PROFILE_URL,
      provider: 'prospeo',
      result: null,
    });
  });

  it('starts the form empty when the prefill is not a profile URL', () => {
    expect(readyWith('https://www.linkedin.com/feed/').url).toBe('');
    expect(readyWith(undefined).url).toBe('');
  });

  it('defaults the provider label when init omits it', () => {
    const state = reduce(initialState, { type: 'init', hasKey: true });
    expect(state.provider).toBe(DEFAULT_PROVIDER);
  });
});

describe('url-changed', () => {
  it('accepts a valid URL back into ready', () => {
    const state = reduce(readyWith(''), { type: 'url-changed', url: PROFILE_URL });
    expect(state).toEqual({ name: 'ready', url: PROFILE_URL, provider: 'prospeo', result: null });
  });

  it('moves a malformed URL to invalid-url', () => {
    const state = reduce(readyWith(''), { type: 'url-changed', url: 'linkedin.com/john' });
    expect(state.name).toBe('invalid-url');
    expect(state.url).toBe('linkedin.com/john');
  });

  it('returns an emptied input to ready', () => {
    const invalid = reduce(readyWith(''), { type: 'url-changed', url: 'nope' });
    const state = reduce(invalid, { type: 'url-changed', url: '' });
    expect(state.name).toBe('ready');
    expect(state.url).toBe('');
  });

  it('is ignored while a lookup is in flight', () => {
    const loading = reduce(readyWith(PROFILE_URL), { type: 'submit' });
    const state = reduce(loading, { type: 'url-changed', url: 'https://www.linkedin.com/in/other' });
    expect(state.name).toBe('loading');
    expect(state.url).toBe(PROFILE_URL);
  });
});

describe('submit', () => {
  it('moves a ready state with a valid URL to loading', () => {
    const state = reduce(readyWith(PROFILE_URL), { type: 'submit' });
    expect(state.name).toBe('loading');
    expect(state.result).toBe(null);
  });

  it('does nothing without a valid URL', () => {
    expect(reduce(readyWith(''), { type: 'submit' }).name).toBe('ready');
    const invalid = reduce(readyWith(''), { type: 'url-changed', url: 'not-a-url' });
    expect(reduce(invalid, { type: 'submit' }).name).toBe('invalid-url');
  });
});

describe('result', () => {
  it('maps each adapter outcome to its display state', () => {
    const results = [
      [EMAIL_RESULT, 'found'],
      [{ status: 'not_found', provider: 'prospeo' }, 'not-found'],
      [{ status: 'error', code: 'no_key', message: 'rejected' }, 'no-key'],
      [{ status: 'error', code: 'rate_limited', message: 'wait' }, 'rate-limited'],
      [{ status: 'error', code: 'network', message: 'offline' }, 'network'],
      [{ status: 'error', code: 'provider', message: 'HTTP 500' }, 'provider-error'],
    ];

    for (const [result, expected] of results) {
      const state = reduce(reduce(readyWith(PROFILE_URL), { type: 'submit' }), {
        type: 'result',
        result,
      });
      expect(state.name).toBe(expected);
      expect(state.result).toEqual(result);
    }
  });

  it('is ignored when no lookup is in flight', () => {
    const state = readyWith(PROFILE_URL);
    expect(reduce(state, { type: 'result', result: EMAIL_RESULT })).toEqual(state);
  });
});

describe('new-lookup', () => {
  it('returns a settled state to the form with the URL kept', () => {
    for (const name of ['found', 'not-found', 'rate-limited', 'network', 'provider-error']) {
      const settled = { ...readyWith(PROFILE_URL), name, result: EMAIL_RESULT };
      const state = reduce(settled, { type: 'new-lookup' });
      expect(state.name).toBe('ready');
      expect(state.url).toBe(PROFILE_URL);
      expect(state.result).toBe(null);
    }
  });

  it('is ignored while loading or before a lookup', () => {
    expect(reduce(readyWith(PROFILE_URL), { type: 'new-lookup' }).name).toBe('ready');
    const loading = reduce(readyWith(PROFILE_URL), { type: 'submit' });
    expect(reduce(loading, { type: 'new-lookup' }).name).toBe('loading');
    expect(reduce({ ...readyWith(''), name: 'no-key' }, { type: 'new-lookup' }).name).toBe('no-key');
  });
});

describe('lookup journey', () => {
  it('walks init → form → loading → found → form and runs again', () => {
    let state = reduce(initialState, {
      type: 'init',
      hasKey: true,
      provider: 'prospeo',
    });
    state = reduce(state, { type: 'url-changed', url: PROFILE_URL });
    state = reduce(state, { type: 'submit' });
    expect(state.name).toBe('loading');

    state = reduce(state, { type: 'result', result: EMAIL_RESULT });
    expect(state.name).toBe('found');
    expect(state.result.email).toBe('r.sterling@sterlingcooper.com');

    state = reduce(state, { type: 'new-lookup' });
    expect(state).toEqual({ name: 'ready', url: PROFILE_URL, provider: 'prospeo', result: null });

    state = reduce(state, { type: 'submit' });
    expect(state.name).toBe('loading');
  });
});
