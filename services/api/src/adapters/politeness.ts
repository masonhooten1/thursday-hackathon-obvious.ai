/**
 * The shared politeness client for every external data source (spec: one
 * request in flight per host, spacing between requests, identifying
 * User-Agent, exponential backoff on 429/5xx, no retry on 403).
 *
 * Backoff, spacing, and single-flight queues are deterministic — clock and
 * fetch are injected so tests observe the exact sequence without real time.
 */

/** Thrown for HTTP failure responses after the retry policy is exhausted. */
export class PoliteHttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, detail: string) {
    super(`HTTP ${status} for ${url}${detail ? `: ${detail}` : ""}`);
    this.name = "PoliteHttpError";
    this.status = status;
    this.url = url;
  }
}

export interface PolitenessOptions {
  /** Identifying User-Agent sent on every request. */
  userAgent: string;
  /** Minimum gap between request starts to the same host. Default 1 s. */
  minSpacingMs?: number;
  /** Total attempts for retryable failures. Default 3 (first try + 2 retries). */
  maxAttempts?: number;
  /** Base delay for exponential backoff; attempt n waits base * 2^(n-1). Default 1 s. */
  backoffBaseMs?: number;
  /** Injectable fetch (tests). Default: globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable delay (tests observe backoff without real time). */
  sleep?: (ms: number) => Promise<void>;
}

interface HostQueue {
  /** Tail of the per-host single-flight chain — resolves when the last request finished. */
  tail: Promise<void>;
  /** Start time of the most recent request to this host. */
  lastStartAt: number;
}

export class PoliteClient {
  private readonly userAgent: string;
  private readonly minSpacingMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly queues = new Map<string, HostQueue>();

  constructor(options: PolitenessOptions, now: () => number = () => Date.now()) {
    this.userAgent = options.userAgent;
    this.minSpacingMs = options.minSpacingMs ?? 1000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 1000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = now;
  }

  /** GETs `url` and parses the body as JSON, enforcing the politeness policy. */
  async getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const response = await this.get(url, headers);
    return response.json() as Promise<unknown>;
  }

  /**
   * GETs `url` under the politeness policy. Retries 429/5xx and network errors
   * with exponential backoff (honoring Retry-After); never retries 403 — a
   * block is a signal, not an error to hammer — nor other 4xx responses, which
   * are deterministic. Serialization and spacing are per host, so distinct
   * hosts proceed independently. Extra headers (e.g. RIDB's apikey) merge over
   * the base set.
   */
  async get(url: string, headers: Record<string, string> = {}): Promise<Response> {
    const host = new URL(url).host;
    return this.enqueueOn(host, () => this.withRetries(url, headers));
  }

  private enqueueOn<T>(host: string, task: () => Promise<T>): Promise<T> {
    const queue = this.queues.get(host) ?? { tail: Promise.resolve(), lastStartAt: Number.NEGATIVE_INFINITY };
    const run = async (): Promise<T> => {
      // Spacing counts from the previous request's start, so a slow response
      // cannot shorten the enforced gap between requests.
      const wait = queue.lastStartAt + this.minSpacingMs - this.now();
      if (wait > 0) await this.sleep(wait);
      queue.lastStartAt = this.now();
      return task();
    };
    const result = queue.tail.then(run, run);
    // The next request waits for this one to finish (single flight per host);
    // a failure must not poison the queue, so the tail always resolves.
    queue.tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(host, queue);
    return result;
  }

  private async withRetries(url: string, extraHeaders: Record<string, string>): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": this.userAgent,
            ...extraHeaders,
          },
          redirect: "follow",
        });
        if (response.ok) return response;
        // Consuming the body releases the connection and yields a diagnostic
        // snippet; failure bodies are small, unlike the success payload.
        const error = await this.errorFrom(url, response);
        if (!this.isRetryableStatus(response.status)) throw error;
        lastError = error;
        if (attempt < this.maxAttempts) {
          await this.sleep(
            this.parseRetryAfterMs(response.headers) ?? this.backoffBaseMs * 2 ** (attempt - 1),
          );
        }
      } catch (error) {
        if (error instanceof PoliteHttpError) throw error;
        // Network-level failure (DNS, timeout, reset) — transient, retried.
        lastError = error;
        if (attempt < this.maxAttempts) {
          await this.sleep(this.backoffBaseMs * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`request failed: ${url}`);
  }

  private isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 599);
  }

  private async errorFrom(url: string, response: Response): Promise<PoliteHttpError> {
    const snippet = (await response.text()).slice(0, 200);
    let detail = snippet;
    if (response.status === 403) {
      detail = `blocked — not retrying per politeness policy${snippet ? `: ${snippet}` : ""}`;
    }
    return new PoliteHttpError(response.status, url, detail);
  }

  /** Retry-After may be seconds (delta-seconds); dates are not honored — too rare to matter here. */
  private parseRetryAfterMs(headers: Headers): number | null {
    const raw = headers.get("retry-after");
    if (!raw) return null;
    const seconds = Number(raw);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return seconds * 1000;
  }
}
