import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENDPOINT, findEmailByLinkedInUrl } from '../../src/providers/prospeo.js';
import { jsonResponse, stubFetch } from '../helpers/http.js';
import foundFixture from '../fixtures/prospeo/found.json';
import notFoundFixture from '../fixtures/prospeo/not_found.json';
import rateLimitedFixture from '../fixtures/prospeo/rate_limited.json';
import unauthorizedFixture from '../fixtures/prospeo/unauthorized.json';

const PROFILE_URL = 'https://www.linkedin.com/in/roger-sterling';
const API_KEY = 'test-key-123';

let fetchMock;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('findEmailByLinkedInUrl (prospeo)', () => {
  it('returns no_key without a network call when the key is missing', async () => {
    const result = await findEmailByLinkedInUrl(PROFILE_URL, {});

    expect(result).toEqual({
      status: 'error',
      code: 'no_key',
      message: 'Add your Prospeo API key in extension options.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the profile URL to the default endpoint and normalizes a found result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, foundFixture));

    const result = await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe(DEFAULT_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-KEY': API_KEY });
    expect(init.body).toBe(JSON.stringify({ linkedin_url: PROFILE_URL }));
    expect(result).toEqual({
      status: 'found',
      email: 'r.sterling@sterlingcooper.com',
      confidence: 92,
      provider: 'prospeo',
    });
  });

  it('omits confidence when the provider sends none', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { person: { email: 'r.sterling@sterlingcooper.com' } }),
    );

    const result = await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(result).toEqual({
      status: 'found',
      email: 'r.sterling@sterlingcooper.com',
      provider: 'prospeo',
    });
    expect('confidence' in result).toBe(false);
  });

  it('classifies a 200 without an email as not_found', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, notFoundFixture));

    expect(await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY })).toEqual({
      status: 'not_found',
      provider: 'prospeo',
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
        message: 'Prospeo rejected the API key. Re-check it in options.',
      });
    }
  });

  it('classifies other non-2xx statuses as provider', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));

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
      message: 'Could not reach Prospeo. Check your connection and retry.',
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

  it('honors the __PROSPEO_ENDPOINT__ override', async () => {
    vi.stubGlobal('__PROSPEO_ENDPOINT__', 'https://stub.test/prospeo');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, foundFixture));

    await findEmailByLinkedInUrl(PROFILE_URL, { apiKey: API_KEY });

    expect(fetchMock.mock.calls[0][0]).toBe('https://stub.test/prospeo');
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
