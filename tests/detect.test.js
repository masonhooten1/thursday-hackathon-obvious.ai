import { describe, expect, it } from 'vitest';
import { parseProfileHandle } from '../src/content/detect.js';

describe('parseProfileHandle', () => {
  it('reads the handle from a plain profile URL', () => {
    expect(parseProfileHandle('https://www.linkedin.com/in/john-doe')).toBe('john-doe');
  });

  it('accepts the apex and country-subdomain hosts', () => {
    expect(parseProfileHandle('https://linkedin.com/in/jane-doe')).toBe('jane-doe');
    expect(parseProfileHandle('https://uk.linkedin.com/in/sam-reed')).toBe('sam-reed');
  });

  it('is case-insensitive about the host', () => {
    expect(parseProfileHandle('https://WWW.LINKEDIN.COM/in/john-doe')).toBe('john-doe');
  });

  it('ignores trailing paths and query strings', () => {
    expect(parseProfileHandle('https://www.linkedin.com/in/john-doe/details/')).toBe('john-doe');
    expect(parseProfileHandle('https://www.linkedin.com/in/john-doe?trk=feed')).toBe('john-doe');
    expect(
      parseProfileHandle('https://www.linkedin.com/in/john-doe/detail/?trk=feed&originalSubdomain=uk'),
    ).toBe('john-doe');
  });

  it('decodes percent-encoded handles', () => {
    expect(parseProfileHandle('https://www.linkedin.com/in/john%2Ddoe')).toBe('john-doe');
  });

  it('returns null for the empty /in/ path', () => {
    expect(parseProfileHandle('https://www.linkedin.com/in/')).toBe(null);
  });

  it('returns null for non-profile LinkedIn pages', () => {
    expect(parseProfileHandle('https://www.linkedin.com/feed/')).toBe(null);
    expect(parseProfileHandle('https://www.linkedin.com/company/acme/')).toBe(null);
  });

  it('returns null for /in/ paths on hosts that are not LinkedIn', () => {
    expect(parseProfileHandle('https://facebook.com/in/john-doe')).toBe(null);
    expect(parseProfileHandle('https://evil-linkedin.com/in/john-doe')).toBe(null);
    expect(parseProfileHandle('https://linkedin.com.evil.com/in/john-doe')).toBe(null);
  });

  it('returns null for unparseable input', () => {
    expect(parseProfileHandle('not a url')).toBe(null);
    expect(parseProfileHandle('')).toBe(null);
    expect(parseProfileHandle(null)).toBe(null);
    expect(parseProfileHandle(undefined)).toBe(null);
  });
});
