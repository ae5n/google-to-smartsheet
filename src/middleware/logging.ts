import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';

interface LogEntry {
  timestamp: string;
  method: string;
  url: string;
  ip: string;
  userAgent: string;
  userId?: string;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

class Logger {
  private logDir: string;

  constructor() {
    this.logDir = path.resolve('./logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private writeLog(filename: string, entry: LogEntry): void {
    const logPath = path.join(this.logDir, filename);
    const logLine = JSON.stringify(entry) + '\n';
    
    fs.appendFile(logPath, logLine, (err) => {
      if (err) {
        console.error('Failed to write log entry:', err);
      }
    });
  }

  logRequest(req: Request, res: Response, responseTime: number): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      userId: req.session?.user?.id,
      statusCode: res.statusCode,
      responseTime
    };

    this.writeLog(`access-${new Date().toISOString().split('T')[0]}.log`, entry);
  }

  logError(req: Request, error: Error): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      userId: req.session?.user?.id,
      error: error.message
    };

    this.writeLog(`error-${new Date().toISOString().split('T')[0]}.log`, entry);
  }

  logAuth(req: Request, action: string, success: boolean, details?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      userId: req.session?.user?.id,
      error: success ? undefined : `Auth ${action} failed: ${details}`
    };

    this.writeLog(`auth-${new Date().toISOString().split('T')[0]}.log`, entry);
  }
}

const logger = new Logger();

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    logger.logRequest(req, res, responseTime);
  });

  next();
};

export const errorLogger = (error: Error, req: Request, res: Response, next: NextFunction): void => {
  logger.logError(req, error);
  next(error);
};

export const authLogger = logger.logAuth.bind(logger);

export default logger;