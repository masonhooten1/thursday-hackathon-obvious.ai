import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENDPOINT, findEmailByLinkedInUrl } from '../../src/providers/hunter.js';
import { jsonResponse, stubFetch } from '../helpers/http.js';
import foundFixture from '../fixtures/hunter/found.json';
import notFoundFixture from '../fixtures/hunter/not_found.json';
import rateLimitedFixture from '../fixtures/hunter/rate_limited.json';
import unauthorizedFixture from '../fixtures/hunter/unauthorized.json';

const PROFILE_URL = 'https://www.linkedin.com/in/roger-sterling';
const API_KEY = 'test-key-123';

let fetchMock;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('findEmailByLinkedInUrl (hunter)', () => {
  it('returns no_key without a network call when the key is missing', async () => {
    const result = await findEmailByLinkedInUrl(PROFILE_URL, {});

    expect(result).toEqual({
      status: 'error',
      code: 'no_key',
      message: 'Add your Hunter API key in extension options.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the derived handle and key as query params and normalizes a found result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, foundFixture));

    const result = await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0];
    const parsed = new URL(requestUrl);
    expect(parsed.origin + parsed.pathname).toBe(DEFAULT_ENDPOINT);
    expect(parsed.searchParams.get('api_key')).toBe(API_KEY);
    expect(parsed.searchParams.get('linkedin_handle')).toBe('roger-sterling');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(result).toEqual({
      status: 'found',
      email: 'roger.sterling@sterlingcooper.com',
      confidence: 95,
      provider: 'hunter',
    });
  });

  it('keeps a zero score as confidence 0', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { email: 'x@y.com', score: 0 } }));

    const result = await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(result).toEqual({ status: 'found', email: 'x@y.com', confidence: 0, provider: 'hunter' });
  });

  it('normalizes both miss shapes as not_found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, notFoundFixture));
    expect(await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY })).toEqual({
      status: 'not_found',
      provider: 'hunter',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { email: null } }));
    expect(await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY })).toEqual({
      status: 'not_found',
      provider: 'hunter',
    });
  });

  it('classifies 429 as rate_limited', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, rateLimitedFixture));

    const result = await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(result.status).toBe('error');
    expect(result.code).toBe('rate_limited');
    expect(result.message).toMatch(/rate limit/i);
  });

  it('classifies 401 and 403 as no_key', async () => {
    for (const status of [401, 403]) {
      fetchMock.mockResolvedValueOnce(jsonResponse(status, unauthorizedFixture));
      const result = await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });
      expect(result).toEqual({
        status: 'error',
        code: 'no_key',
        message: 'Hunter rejected the API key. Re-check it in options.',
      });
    }
  });

  it('classifies other non-2xx statuses as provider', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { errors: [{ code: 500 }] }));

    const result = await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(result.status).toBe('error');
    expect(result.code).toBe('provider');
    expect(result.message).toContain('500');
  });

  it('classifies a rejected fetch as network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(result).toEqual({
      status: 'error',
      code: 'network',
      message: 'Could not reach Hunter. Check your connection and retry.',
    });
  });

  it('classifies an unreadable 200 body as provider', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });

    const result = await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(result.status).toBe('error');
    expect(result.code).toBe('provider');
  });

  it('honors the __HUNTER_ENDPOINT__ override', async () => {
    vi.stubGlobal('__HUNTER_ENDPOINT__', 'https://stub.test/hunter');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, foundFixture));

    await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://stub.test/hunter?api_key=test-key-123&linkedin_handle=roger-sterling',
    );
  });

  it('forwards the AbortSignal', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, foundFixture));
    const controller = new AbortController();

    await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY, signal: controller.signal });

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('rejects non-profile URLs without a network call', async () => {
    const result = await findEmailByLinkedInUrl('https://facebook.com/in/john-doe', {
      apiKey: API_KEY,
    });

    expect(result).toEqual({
      status: 'error',
      code: 'provider',
      message: 'That URL is not a LinkedIn profile URL.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
