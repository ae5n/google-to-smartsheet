import { NextFunction, Request, Response } from 'express';
import { Options } from 'express-rate-limit';
import { csrfProtection, isExempt, rateLimitHandler } from '../security';

const request = (path: string, extras: Record<string, unknown> = {}) =>
  ({
    path,
    originalUrl: path,
    url: path,
    method: 'GET',
    session: {},
    ...extras
  } as unknown as Request);

describe('security middleware', () => {
  it('does not spend API quota on health, sockets, static assets, or SPA navigation', () => {
    expect(isExempt(request('/health'))).toBe(true);
    expect(isExempt(request('/socket.io/'))).toBe(true);
    expect(isExempt(request('/static/js/main.js'))).toBe(true);
    expect(isExempt(request('/history'))).toBe(true);
    expect(isExempt(request('/api/transfer/jobs/123'))).toBe(false);
  });

  it('returns the actual remaining wait instead of the full rate-limit window', () => {
    const headers: Record<string, string> = {};
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      status
    } as unknown as Response;
    const req = request('/api/transfer/jobs/123', {
      originalUrl: '/api/transfer/jobs/123?token=secret-token',
      rateLimit: { resetTime: new Date(Date.now() + 5_000) }
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    rateLimitHandler(
      req,
      res,
      jest.fn() as NextFunction,
      { windowMs: 300_000, statusCode: 429, message: 'Slow down' } as Options
    );

    expect(Number(headers['Retry-After'])).toBeGreaterThanOrEqual(4);
    expect(Number(headers['Retry-After'])).toBeLessThanOrEqual(5);
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ retryAfter: expect.any(Number) }));
    expect(warn).toHaveBeenCalledWith(expect.not.stringContaining('secret-token'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"path":"/api/transfer/jobs/123"'));
    warn.mockRestore();
  });

  it('marks CSRF failures so the client only retries the safe rejection case', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const res = { status } as unknown as Response;
    const req = request('/api/transfer/jobs', {
      method: 'POST',
      headers: {},
      body: {},
      session: { csrfToken: 'expected' }
    });

    csrfProtection(req, res, jest.fn());

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Invalid CSRF token', code: 'CSRF_INVALID' });
  });
});
