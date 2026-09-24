import { vi } from 'vitest';

// Replaces global fetch with a vi.fn and returns it. Pair with
// vi.unstubAllGlobals() in afterEach.
export function stubFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// A minimal Response stand-in — the adapters only read status, ok, and json().
export function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
