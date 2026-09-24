import { describe, expect, it } from 'vitest';
import { displayFromResult } from '../../src/content/pill.js';

describe('displayFromResult', () => {
  it('shows the email on a found result', () => {
    expect(displayFromResult({ status: 'found', email: 'r@co.com', provider: 'prospeo' })).toEqual({
      tone: 'found',
      label: 'r@co.com',
    });
  });

  it('keeps a miss distinct from an error', () => {
    expect(displayFromResult({ status: 'not_found', provider: 'hunter' })).toEqual({
      tone: 'miss',
      label: 'No email found',
    });
  });

  it('maps each error code to a short honest label', () => {
    const cases = [
      ['no_key', 'Add your API key in options'],
      ['rate_limited', 'Rate limited — retry soon'],
      ['network', 'Connection problem'],
      ['provider', 'Lookup failed'],
    ];

    for (const [code, label] of cases) {
      expect(displayFromResult({ status: 'error', code, message: 'full message' })).toEqual({
        tone: 'error',
        label,
      });
    }
  });

  it('falls back to the failure label when no listener answered', () => {
    expect(displayFromResult(undefined)).toEqual({ tone: 'error', label: 'Lookup failed' });
    expect(displayFromResult(null)).toEqual({ tone: 'error', label: 'Lookup failed' });
  });
});
