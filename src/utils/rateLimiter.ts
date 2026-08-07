/**
 * Client-side throttling and retry for outbound third-party API calls.
 *
 * Two independent mechanisms, usually used together:
 *
 *  - `TokenBucket` paces requests so we stay under a provider's published
 *    quota before they ever reject us.
 *  - `withRetry` recovers when we get rejected anyway (429s, 5xx, transient
 *    socket errors), honouring `Retry-After` when the provider sends it.
 *
 * A 429 also trips a shared cooldown on the bucket, so every concurrent
 * caller backs off together instead of each discovering the limit alone.
 */

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  /** Epoch ms before which no token may be handed out. Set by `cooldown()`. */
  private blockedUntil = 0;
  private queue: Array<() => void> = [];
  private draining = false;

  constructor(
    public readonly name: string,
    private readonly capacity: number,
    private readonly refillPerSecond: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSecond);
    this.lastRefill = now;
  }

  /**
   * Pause the entire bucket. Called when a provider tells us we are over
   * quota, so sibling requests in flight do not keep hammering it.
   */
  public cooldown(ms: number): void {
    const until = Date.now() + ms;
    if (until > this.blockedUntil) {
      this.blockedUntil = until;
    }
  }

  public async acquire(): Promise<void> {
    await new Promise<void>(resolve => {
      this.queue.push(resolve);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length > 0) {
        const now = Date.now();

        if (now < this.blockedUntil) {
          await sleep(this.blockedUntil - now);
          continue;
        }

        this.refill();

        if (this.tokens < 1) {
          const deficit = 1 - this.tokens;
          await sleep(Math.max(25, Math.ceil((deficit / this.refillPerSecond) * 1000)));
          continue;
        }

        this.tokens -= 1;
        const next = this.queue.shift();
        next?.();
      }
    } finally {
      this.draining = false;
      // A caller may have enqueued while we were tearing down the loop.
      if (this.queue.length > 0) void this.drain();
    }
  }
}

/** Limits how many operations run at once, independent of request pacing. */
export class ConcurrencyGate {
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  public async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.waiting.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.waiting.shift();
      next?.();
    }
  }
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  status?: number;
  reason: string;
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Bucket to put into cooldown when the provider returns 429. */
  bucket?: TokenBucket;
  label?: string;
  onRetry?: (info: RetryInfo) => void;
  /**
   * Set false for writes that would duplicate data if replayed (row inserts).
   * Restricts retries to statuses that prove the request was never processed.
   */
  idempotent?: boolean;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ERR_NETWORK',
  'ERR_BAD_RESPONSE'
]);

/** Normalises the many shapes axios and googleapis use to report failures. */
export function describeApiError(error: any): { status?: number; code?: string; message: string } {
  const status: number | undefined =
    error?.response?.status ??
    (typeof error?.code === 'number' ? error.code : undefined) ??
    error?.status;

  const code: string | undefined = typeof error?.code === 'string' ? error.code : undefined;

  const message: string =
    error?.response?.data?.message ||
    error?.response?.data?.error?.message ||
    error?.errors?.[0]?.message ||
    error?.message ||
    'Unknown error';

  return { status, code, message };
}

/**
 * Statuses that guarantee the request never reached the application, so a
 * retry cannot duplicate a write. Used for non-idempotent calls like row
 * inserts, where a timed-out request may well have succeeded server-side and
 * retrying it would insert the rows twice.
 */
const SAFE_NON_IDEMPOTENT_STATUS = new Set([429, 503]);

export function isSafeNonIdempotentRetry(error: any): boolean {
  const { status } = describeApiError(error);
  return status !== undefined && SAFE_NON_IDEMPOTENT_STATUS.has(status);
}

export function isRetryableError(error: any): boolean {
  const { status, code } = describeApiError(error);
  if (status !== undefined && RETRYABLE_STATUS.has(status)) return true;
  if (code && RETRYABLE_CODES.has(code)) return true;
  // axios surfaces aborted sockets with no code and no response
  if (!status && !error?.response && /socket hang up|network error|timeout/i.test(error?.message || '')) {
    return true;
  }
  return false;
}

/** Reads `Retry-After` (delta-seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(error: any): number | undefined {
  const header =
    error?.response?.headers?.['retry-after'] ??
    error?.response?.headers?.['Retry-After'];
  if (header === undefined || header === null) return undefined;

  const asNumber = Number(header);
  if (!Number.isNaN(asNumber)) return Math.max(0, asNumber * 1000);

  const asDate = Date.parse(String(header));
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());

  return undefined;
}

/**
 * Runs `fn`, retrying transient failures with exponential backoff and full
 * jitter. Non-retryable errors propagate immediately so callers still see
 * real problems (bad column id, revoked token) without delay.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    bucket,
    label = 'request',
    onRetry,
    idempotent = true
  } = options;

  const retryable = idempotent ? isRetryableError : isSafeNonIdempotentRetry;
  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt >= maxAttempts || !retryable(error)) {
        throw error;
      }

      const { status, message } = describeApiError(error);
      const retryAfter = parseRetryAfter(error);

      // Full jitter: spreads a thundering herd of sibling retries.
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jittered = Math.floor(Math.random() * backoff);
      const delayMs = Math.max(retryAfter ?? 0, jittered, baseDelayMs);

      if (status === 429 && bucket) {
        bucket.cooldown(delayMs);
      }

      onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        status,
        reason: status ? `HTTP ${status}: ${message}` : message
      });

      console.warn(
        `⏳ ${label} attempt ${attempt}/${maxAttempts} failed (${status ?? 'network'}) — retrying in ${delayMs}ms`
      );

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Provider budgets. Deliberately below the published ceilings so bursts from
 * a second concurrent job do not push the account over.
 *
 * Smartsheet: 300 requests/min per access token.
 * Google Sheets/Drive: 60 read requests/min per user.
 */
export const smartsheetBucket = new TokenBucket('smartsheet', 20, 3.5); // ~210/min
export const googleBucket = new TokenBucket('google', 10, 0.8); // ~48/min

/** Caps parallel image work so a batch cannot burst the buckets dry. */
export const imageGate = new ConcurrencyGate(4);

/** Acquire a slot, then run with retry — the standard call path. */
export async function throttled<T>(
  bucket: TokenBucket,
  fn: () => Promise<T>,
  options: Omit<RetryOptions, 'bucket'> = {}
): Promise<T> {
  return withRetry(
    async () => {
      await bucket.acquire();
      return fn();
    },
    { ...options, bucket }
  );
}
