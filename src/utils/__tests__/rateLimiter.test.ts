import {
  TokenBucket,
  ConcurrencyGate,
  withRetry,
  isRetryableError,
  isSafeNonIdempotentRetry,
  parseRetryAfter
} from '../rateLimiter';

const httpError = (status: number, headers: Record<string, string> = {}) => ({
  response: { status, headers, data: { message: `status ${status}` } },
  message: `Request failed with status code ${status}`
});

describe('error classification', () => {
  it('treats throttling and transient server errors as retryable', () => {
    expect(isRetryableError(httpError(429))).toBe(true);
    expect(isRetryableError(httpError(503))).toBe(true);
    expect(isRetryableError(httpError(500))).toBe(true);
    expect(isRetryableError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(true);
  });

  it('does not retry client errors that will never succeed', () => {
    expect(isRetryableError(httpError(400))).toBe(false);
    expect(isRetryableError(httpError(401))).toBe(false);
    expect(isRetryableError(httpError(403))).toBe(false);
    expect(isRetryableError(httpError(404))).toBe(false);
  });

  it('restricts non-idempotent retries to statuses that prove no side effect', () => {
    // A timeout or a 500 may mean the rows were inserted; replaying would
    // duplicate them, so these must not be retried for writes.
    expect(isSafeNonIdempotentRetry(httpError(429))).toBe(true);
    expect(isSafeNonIdempotentRetry(httpError(503))).toBe(true);
    expect(isSafeNonIdempotentRetry(httpError(500))).toBe(false);
    expect(isSafeNonIdempotentRetry(httpError(504))).toBe(false);
    expect(isSafeNonIdempotentRetry({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter(httpError(429, { 'retry-after': '5' }))).toBe(5000);
  });

  it('reads an HTTP date', () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const parsed = parseRetryAfter(httpError(429, { 'retry-after': future }))!;
    expect(parsed).toBeGreaterThan(8000);
    expect(parsed).toBeLessThanOrEqual(11_000);
  });

  it('returns undefined when the header is absent', () => {
    expect(parseRetryAfter(httpError(429))).toBeUndefined();
  });
});

describe('withRetry', () => {
  it('retries a 429 and returns the eventual success', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw httpError(429);
        return 'ok';
      },
      { baseDelayMs: 1, maxDelayMs: 5 }
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw httpError(503);
        },
        { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 }
      )
    ).rejects.toMatchObject({ response: { status: 503 } });

    expect(calls).toBe(3);
  });

  it('fails fast on a non-retryable error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw httpError(400);
        },
        { maxAttempts: 5, baseDelayMs: 1 }
      )
    ).rejects.toBeDefined();

    expect(calls).toBe(1);
  });

  it('does not replay a non-idempotent write that timed out', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw { code: 'ECONNABORTED', message: 'timeout of 60000ms exceeded' };
        },
        { maxAttempts: 5, baseDelayMs: 1, idempotent: false }
      )
    ).rejects.toBeDefined();

    // One attempt only: the request may have succeeded server-side.
    expect(calls).toBe(1);
  });

  it('waits at least as long as Retry-After asks', async () => {
    const started = Date.now();
    let calls = 0;

    await withRetry(
      async () => {
        calls++;
        if (calls === 1) throw httpError(429, { 'retry-after': '1' });
        return 'ok';
      },
      { baseDelayMs: 1, maxDelayMs: 5000 }
    );

    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });
});

describe('TokenBucket', () => {
  it('paces acquisitions once the initial capacity is spent', async () => {
    // Capacity 2, refilling 20/sec => the 3rd acquire waits ~50ms.
    const bucket = new TokenBucket('test', 2, 20);

    await bucket.acquire();
    await bucket.acquire();

    const started = Date.now();
    await bucket.acquire();
    const waited = Date.now() - started;

    expect(waited).toBeGreaterThanOrEqual(30);
  });

  it('blocks every waiter for the duration of a cooldown', async () => {
    const bucket = new TokenBucket('test', 10, 100);
    bucket.cooldown(120);

    const started = Date.now();
    await bucket.acquire();

    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });
});

describe('ConcurrencyGate', () => {
  it('never runs more than the configured number of tasks at once', async () => {
    const gate = new ConcurrencyGate(3);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 20 }, () =>
        gate.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise(resolve => setTimeout(resolve, 5));
          active--;
        })
      )
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(active).toBe(0);
  });

  it('releases its slot when a task throws', async () => {
    const gate = new ConcurrencyGate(1);

    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    // If the slot leaked, this would hang rather than resolve.
    await expect(gate.run(async () => 'fine')).resolves.toBe('fine');
  });
});
