import { describe, expect, it } from "vitest";
import { PoliteClient } from "./politeness";

const UA = "CampgroundTonight/0.1 (test)";
const RECREATION_URL = "https://www.recreation.gov/api/camps/availability/campground/232490/month";
const RIDB_URL = "https://ridb.recreation.gov/api/v1/facilities/232490";

const ok = (body: unknown = { ok: true }) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number, headers?: Record<string, string>) =>
  new Response(JSON.stringify({ error: code }), { status: code, headers });

interface Harness {
  client: PoliteClient;
  /** Every fetch the client made: [url, init]. */
  calls: Array<[string, RequestInit]>;
  /** Delays the client requested (spacing, backoff, Retry-After). */
  sleeps: number[];
}

/** Builds a client whose fetch responses are queued up front. */
function harness(responses: Array<Response | Error>, now: () => number = () => Date.now()): Harness {
  const calls: Array<[string, RequestInit]> = [];
  const sleeps: number[] = [];
  const queue = [...responses];
  const fetchImpl: typeof fetch = (input, init) => {
    calls.push([String(input), init ?? {}]);
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    if (!next) throw new Error("harness ran out of queued responses");
    return Promise.resolve(next);
  };
  const client = new PoliteClient({
    userAgent: UA,
    fetchImpl,
    // Record and resolve immediately; the fake `now` handles spacing tests.
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  }, now);
  return { client, calls, sleeps };
}

/** Call headers by call index — throws (failing the test) if the call is absent. */
function callHeaders(h: Harness, index: number): Record<string, string> {
  const call = h.calls[index];
  if (!call) throw new Error(`expected a call at index ${index}`);
  return call[1].headers as Record<string, string>;
}

describe("PoliteClient", () => {
  it("sends an identifying User-Agent and JSON Accept on every request", async () => {
    const h = harness([ok()]);
    await h.client.getJson(RECREATION_URL);
    expect(h.calls).toHaveLength(1);
    const headers = callHeaders(h, 0);
    expect(headers["User-Agent"]).toBe(UA);
    expect(headers["Accept"]).toBe("application/json");
  });

  it("merges per-request headers over the base set (RIDB apikey)", async () => {
    const h = harness([ok()]);
    await h.client.getJson(RIDB_URL, { apikey: "test-key" });
    const headers = callHeaders(h, 0);
    expect(headers.apikey).toBe("test-key");
    // The extra header must not displace the identifying base headers.
    expect(headers["User-Agent"]).toBe(UA);
    expect(headers["Accept"]).toBe("application/json");
  });

  it("keeps one request in flight per host — the second waits for the first", async () => {
    const calls: string[] = [];
    const gates: Array<{ resolve: (response: Response) => void }> = [];
    const fetchImpl: typeof fetch = (input) => {
      calls.push(String(input));
      let resolve!: (response: Response) => void;
      const promise = new Promise<Response>((r) => {
        resolve = r;
      });
      gates.push({ resolve });
      return promise;
    };
    const client = new PoliteClient({ userAgent: UA, fetchImpl, sleep: async () => {} });

    const first = client.get(RECREATION_URL);
    const second = client.get(RECREATION_URL);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(1); // second is queued behind the first

    gates[0]?.resolve(ok({ first: true }));
    await expect(first).resolves.toHaveProperty("ok", true);
    gates[1]?.resolve(ok({ second: true }));
    await expect(second).resolves.toHaveProperty("ok", true);
    expect(calls).toHaveLength(2);
  });

  it("serializes per host but lets different hosts proceed concurrently", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = (input) => {
      calls.push(String(input));
      return new Promise<Response>(() => {}); // never resolves
    };
    const client = new PoliteClient({ userAgent: UA, fetchImpl, sleep: async () => {} });
    void client.get(RECREATION_URL);
    void client.get(RIDB_URL);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(2); // both started although neither finished
  });

  it("spaces same-host requests by the minimum gap", async () => {
    let nowMs = 50_000;
    const now = () => nowMs;
    const sleeps: number[] = [];
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl: typeof fetch = (input, init) => {
      calls.push([String(input), init ?? {}]);
      return Promise.resolve(ok());
    };
    // A sleep that advances the fake clock, like real elapsed time would.
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      nowMs += ms;
    };
    const client = new PoliteClient({ userAgent: UA, minSpacingMs: 1000, fetchImpl, sleep }, now);
    await client.get(RECREATION_URL);
    await client.get(RECREATION_URL);
    expect(sleeps).toEqual([1000]);
  });

  it("retries 429 and 5xx with exponential backoff", async () => {
    const h = harness([status(429), status(500), ok()]);
    await expect(h.client.getJson(RECREATION_URL)).resolves.toEqual({ ok: true });
    expect(h.calls).toHaveLength(3);
    expect(h.sleeps).toEqual([1000, 2000]);
  });

  it("honors Retry-After when the server asks for a specific wait", async () => {
    const h = harness([status(429, { "Retry-After": "7" }), ok()]);
    await expect(h.client.getJson(RECREATION_URL)).resolves.toEqual({ ok: true });
    expect(h.sleeps).toEqual([7000]);
  });

  it("retries transient network errors", async () => {
    const h = harness([new TypeError("fetch failed: ECONNRESET"), ok()]);
    await expect(h.client.getJson(RECREATION_URL)).resolves.toEqual({ ok: true });
    expect(h.calls).toHaveLength(2);
    expect(h.sleeps).toEqual([1000]);
  });

  it("never retries a 403 — a block is a signal, not an error to hammer", async () => {
    const h = harness([status(403), ok()]);
    await expect(h.client.getJson(RECREATION_URL)).rejects.toMatchObject({
      name: "PoliteHttpError",
      status: 403,
    });
    expect(h.calls).toHaveLength(1);
  });

  it("does not retry other deterministic 4xx failures", async () => {
    const h = harness([status(404)]);
    await expect(h.client.getJson(RECREATION_URL)).rejects.toMatchObject({
      name: "PoliteHttpError",
      status: 404,
    });
    expect(h.calls).toHaveLength(1);
  });

  it("throws after exhausting attempts on persistent 5xx", async () => {
    const h = harness([status(503), status(503), status(503)]);
    await expect(h.client.getJson(RECREATION_URL)).rejects.toMatchObject({
      name: "PoliteHttpError",
      status: 503,
    });
    expect(h.calls).toHaveLength(3);
    expect(h.sleeps).toEqual([1000, 2000]);
  });
});
