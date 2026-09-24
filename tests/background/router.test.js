import { describe, expect, it, vi } from 'vitest';
import { isFindEmailMessage, routeMessage } from '../../src/background/router.js';

const PROFILE_URL = 'https://www.linkedin.com/in/roger-sterling';

// One stub adapter per provider; each resolves a distinct sentinel result so a
// test can prove which adapter the router picked.
const PROSPEO_RESULT = { status: 'found', email: 'prospeo@example.com', provider: 'prospeo' };
const HUNTER_RESULT = { status: 'found', email: 'hunter@example.com', provider: 'hunter' };

function makeDeps({ settings = {}, adapters } = {}) {
  const getSettings = vi.fn().mockResolvedValue(settings);
  return { getSettings, adapters };
}

describe('isFindEmailMessage', () => {
  it('accepts only find-email messages with a string url', () => {
    expect(isFindEmailMessage({ type: 'find-email', url: PROFILE_URL })).toBe(true);
  });

  it('rejects foreign and malformed messages', () => {
    expect(isFindEmailMessage({ type: 'other', url: PROFILE_URL })).toBe(false);
    expect(isFindEmailMessage({ type: 'find-email' })).toBe(false);
    expect(isFindEmailMessage({ type: 'find-email', url: 42 })).toBe(false);
    expect(isFindEmailMessage(null)).toBe(false);
    expect(isFindEmailMessage('find-email')).toBe(false);
  });
});

describe('routeMessage', () => {
  it('returns null for messages the extension does not own', async () => {
    const adapters = { prospeo: vi.fn(), hunter: vi.fn() };
    const result = await routeMessage({ type: 'ping' }, makeDeps({ adapters }));

    expect(result).toBe(null);
    expect(adapters.prospeo).not.toHaveBeenCalled();
  });

  it('rejects an unparseable URL before reading storage or spending a credit', async () => {
    const adapters = { prospeo: vi.fn(), hunter: vi.fn() };
    const { getSettings } = makeDeps({ adapters });
    const result = await routeMessage(
      { type: 'find-email', url: 'https://www.linkedin.com/feed/' },
      { getSettings, adapters },
    );

    expect(result).toEqual({
      status: 'error',
      code: 'provider',
      message: 'That URL is not a LinkedIn profile URL.',
    });
    expect(getSettings).not.toHaveBeenCalled();
    expect(adapters.prospeo).not.toHaveBeenCalled();
  });

  it('routes to the Prospeo adapter by default when no provider is saved', async () => {
    const adapters = {
      prospeo: vi.fn().mockResolvedValue(PROSPEO_RESULT),
      hunter: vi.fn(),
    };

    const result = await routeMessage(
      { type: 'find-email', url: PROFILE_URL },
      makeDeps({ settings: { apiKey: 'key-1' }, adapters }),
    );

    expect(result).toEqual(PROSPEO_RESULT);
    expect(adapters.prospeo).toHaveBeenCalledWith(PROFILE_URL, { apiKey: 'key-1' });
    expect(adapters.hunter).not.toHaveBeenCalled();
  });

  it('routes to the Hunter adapter when the saved provider is hunter', async () => {
    const adapters = {
      prospeo: vi.fn(),
      hunter: vi.fn().mockResolvedValue(HUNTER_RESULT),
    };

    const result = await routeMessage(
      { type: 'find-email', url: PROFILE_URL },
      makeDeps({ settings: { provider: 'hunter', apiKey: 'key-2' }, adapters }),
    );

    expect(result).toEqual(HUNTER_RESULT);
    expect(adapters.hunter).toHaveBeenCalledWith(PROFILE_URL, { apiKey: 'key-2' });
    expect(adapters.prospeo).not.toHaveBeenCalled();
  });

  it('falls back to the default provider on an unknown saved value', async () => {
    const adapters = {
      prospeo: vi.fn().mockResolvedValue(PROSPEO_RESULT),
      hunter: vi.fn(),
    };

    const result = await routeMessage(
      { type: 'find-email', url: PROFILE_URL },
      makeDeps({ settings: { provider: 'snov', apiKey: 'key-3' }, adapters }),
    );

    expect(result).toEqual(PROSPEO_RESULT);
    expect(adapters.prospeo).toHaveBeenCalled();
  });

  it('returns a provider error when the adapter registry is missing the selected adapter', async () => {
    const result = await routeMessage(
      { type: 'find-email', url: PROFILE_URL },
      makeDeps({ settings: { provider: 'hunter', apiKey: 'key-4' }, adapters: {} }),
    );

    expect(result).toEqual({
      status: 'error',
      code: 'provider',
      message: 'No adapter for the selected provider. Reload the extension.',
    });
  });
});
