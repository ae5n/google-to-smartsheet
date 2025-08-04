import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

export const securityMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.smartsheet.com", "https://sheets.googleapis.com"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting in development to avoid trust proxy issues
  skip: (req) => process.env.NODE_ENV === 'development',
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 auth requests per windowMs
  // Skip rate limiting in development to avoid trust proxy issues
  skip: (req) => process.env.NODE_ENV === 'development',
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

export const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const token = req.headers['x-csrf-token'] || req.body._csrf;
  const sessionToken = req.session?.csrfToken;

  if (!token || !sessionToken || token !== sessionToken) {
    res.status(403).json({ error: 'Invalid CSRF token' });
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
    if (!contentType || (!contentType.includes('application/json') && !contentType.includes('multipart/form-data'))) {
      res.status(400).json({ error: 'Invalid content type' });
      return;
    }
  }
  next();
};