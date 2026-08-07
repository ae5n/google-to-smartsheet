import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit, { Options } from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';

export const securityMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        "https://api.smartsheet.com",
        "https://sheets.googleapis.com",
        // WebSocket transport for live job progress.
        "ws:",
        "wss:"
      ]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

/**
 * Stable per-device identifier.
 *
 * Rate limiting purely by IP breaks in both directions: several users behind
 * one office NAT or VPN share a single budget, while one user on a mobile
 * network gets a fresh budget every time their IP rotates. We therefore key
 * on, in order of preference:
 *
 *   1. the authenticated user id  — the correct unit of quota
 *   2. a signed device cookie     — stable before login, survives IP changes
 *   3. the remote IP              — last resort for the very first request
 *
 * The cookie is HMAC-signed so a client cannot forge someone else's key or
 * mint unlimited identities that bypass their own limit.
 */
const DEVICE_COOKIE = 'gts.did';

const signDeviceId = (id: string): string => {
  const mac = crypto
    // SESSION_SECRET is mandatory in production. Reusing it here avoids the
    // old optional CSRF_SECRET fallback, which made device cookies forgeable
    // whenever that optional variable was omitted.
    .createHmac('sha256', config.session.secret)
    .update(id)
    .digest('base64url');
  return `${id}.${mac}`;
};

const verifyDeviceId = (value: string | undefined): string | null => {
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const id = value.slice(0, separator);
  const expected = signDeviceId(id);

  // Constant-time compare; lengths must match first or timingSafeEqual throws.
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return id;
};

export const deviceIdentity = (req: Request, res: Response, next: NextFunction): void => {
  const existing = verifyDeviceId(req.cookies?.[DEVICE_COOKIE]);

  if (existing) {
    (req as any).deviceId = existing;
  } else {
    const id = uuidv4();
    (req as any).deviceId = id;
    res.cookie(DEVICE_COOKIE, signDeviceId(id), {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.server.nodeEnv === 'production',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  }

  next();
};

const clientKey = (req: Request): string => {
  const userId = req.session?.user?.id;
  if (userId) return `user:${userId}`;

  const deviceId = (req as any).deviceId;
  if (deviceId) return `device:${deviceId}`;

  return `ip:${req.ip || 'unknown'}`;
};

/** Always tell the client how long to wait — never let it guess and hammer. */
export const rateLimitHandler = (req: Request, res: Response, _next: NextFunction, options: Options): void => {
  const resetTime = (req as any).rateLimit?.resetTime;
  const resetAt = resetTime instanceof Date ? resetTime.getTime() : Number(resetTime);
  const retryAfterSec = Number.isFinite(resetAt)
    ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
    : Math.ceil(options.windowMs / 1000);

  // Structured stdout is retained by Render. The previous file-only request
  // logger made the production 429s that caused the outage invisible.
  console.warn(JSON.stringify({
    event: 'rate_limit_rejected',
    method: req.method,
    path: req.originalUrl || req.url,
    retryAfterSec,
    authenticated: Boolean(req.session?.user?.id)
  }));

  res.setHeader('Retry-After', String(retryAfterSec));
  res.status(options.statusCode).json({
    success: false,
    error: typeof options.message === 'string' ? options.message : 'Too many requests',
    retryAfter: retryAfterSec
  });
};

const baseOptions = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  keyGenerator: clientKey,
  handler: rateLimitHandler,
  // We key on identity, not IP, so express-rate-limit's trust-proxy guard
  // (which exists to stop IP spoofing) does not apply to us.
  validate: { trustProxy: false, xForwardedForHeader: false }
};

/** Paths that must never be throttled: they are how the app stays healthy. */
export const isExempt = (req: Request): boolean =>
  req.path === '/health' ||
  req.path === '/api/csrf-token' ||
  req.path.startsWith('/socket.io/') ||
  // Static assets and SPA navigation are not API abuse. Counting them made a
  // page refresh consume the same budget used by live transfer updates.
  (!req.path.startsWith('/api/') && !req.path.startsWith('/auth/'));

/**
 * Writes: expensive and rare. This is the bucket that actually protects the
 * server and the upstream APIs.
 */
export const writeRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 5 * 60 * 1000,
  limit: 120,
  message: 'Too many write requests, please slow down',
  skip: (req: Request) =>
    isExempt(req) ||
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS' ||
    req.path.startsWith('/auth/')
});

/**
 * Reads: cheap, and the UI legitimately makes a lot of them while a user
 * clicks through the wizard. Generous ceiling, short window, so a burst
 * recovers in minutes rather than blocking someone for a quarter of an hour.
 */
export const readRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 300,
  message: 'Too many requests, please slow down',
  skip: (req: Request) =>
    isExempt(req) || req.method !== 'GET' || req.path.startsWith('/auth/')
});

/**
 * Job status polling. Only reached when the WebSocket is unavailable, and the
 * client backs off adaptively, so this is a safety net rather than a budget.
 */
export const pollingRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 120,
  message: 'Too many polling requests, please slow down'
});

/** Pre-session auth is scoped to the signed device cookie; authenticated calls use the user id. */
export const authRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  limit: 50,
  message: 'Too many authentication attempts, please try again later'
});

export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const token = req.headers['x-csrf-token'] || req.body._csrf;
  const sessionToken = req.session?.csrfToken;

  if (!token || !sessionToken || token !== sessionToken) {
    res.status(403).json({ error: 'Invalid CSRF token', code: 'CSRF_INVALID' });
    return;
  }

  next();
};

export const generateCSRFToken = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session?.csrfToken) {
    req.session.csrfToken = uuidv4();
  }
  next();
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.session?.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
};

export const validateContentType = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    const contentType = req.headers['content-type'];
    // Allow requests without body (empty POST requests) or with valid content types
    if (contentType && !contentType.includes('application/json') && !contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded')) {
      console.log('Content-Type validation failed:', contentType, 'for', req.method, req.path);
      res.status(400).json({ error: 'Invalid content type' });
      return;
    }
  }
  next();
};

// Retained for backwards compatibility with existing imports.
export const rateLimiter = readRateLimiter;
