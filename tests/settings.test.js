import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  normalizeSettings,
  providerLabel,
  validateApiKey,
} from '../src/settings.js';

describe('normalizeSettings', () => {
  it('defaults to the default provider and no key when storage is empty', () => {
    expect(normalizeSettings(undefined)).toEqual({ provider: DEFAULT_PROVIDER, apiKey: null });
    expect(normalizeSettings(null)).toEqual({ provider: DEFAULT_PROVIDER, apiKey: null });
    expect(normalizeSettings({})).toEqual({ provider: DEFAULT_PROVIDER, apiKey: null });
  });

  it('keeps a valid provider choice', () => {
    expect(normalizeSettings({ provider: 'hunter' }).provider).toBe('hunter');
    expect(normalizeSettings({ provider: 'prospeo' }).provider).toBe('prospeo');
  });

  it('falls back to the default provider on an unknown value', () => {
    expect(normalizeSettings({ provider: 'snov' }).provider).toBe('prospeo');
    expect(normalizeSettings({ provider: 42 }).provider).toBe('prospeo');
  });

  it('trims surrounding whitespace from the key', () => {
    expect(normalizeSettings({ apiKey: '  key-123\n' }).apiKey).toBe('key-123');
  });

  it('collapses missing or whitespace-only keys to null', () => {
    expect(normalizeSettings({ apiKey: '   ' }).apiKey).toBe(null);
    expect(normalizeSettings({ apiKey: 12345 }).apiKey).toBe(null);
  });
});

describe('validateApiKey', () => {
  it('accepts a plain key with no whitespace', () => {
    expect(validateApiKey('abc123')).toBe(null);
  });

  it('rejects an empty or whitespace-only key', () => {
    expect(validateApiKey('')).toBe('Enter your API key.');
    expect(validateApiKey('   ')).toBe('Enter your API key.');
  });

  it('rejects keys containing any whitespace', () => {
    expect(validateApiKey('abc 123')).toBe('API keys contain no spaces — re-copy the key.');
    expect(validateApiKey('abc\n123')).toBe('API keys contain no spaces — re-copy the key.');
  });
});

describe('providerLabel and PROVIDERS', () => {
  it('labels both shipped providers', () => {
    expect(providerLabel('prospeo')).toBe('Prospeo');
    expect(providerLabel('hunter')).toBe('Hunter');
  });

  it('lists the default provider first for the options select', () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(['prospeo', 'hunter']);
  });
});
