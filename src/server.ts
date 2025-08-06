import express from 'express';
import https from 'https';
import http from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import path from 'path';
import fs from 'fs';

import config from './config';
import { ensureSSLCertificates } from './utils/ssl';
import { 
  securityMiddleware, 
  rateLimiter, 
  generateCSRFToken, 
  validateContentType 
} from './middleware/security';
import { requestLogger, errorLogger } from './middleware/logging';
import { initializeDatabase } from './database';
import authRoutes from './routes/auth';
import googleRoutes from './routes/google';
import smartsheetRoutes from './routes/smartsheet';
import transferRoutes from './routes/transfer';


class Server {
  private app: express.Application;
  private httpServer?: http.Server;
  private httpsServer?: https.Server;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Enable trust proxy for development (fixes rate limiter proxy header issues)
    this.app.set('trust proxy', true);
    
    this.app.use(securityMiddleware);
    this.app.use(rateLimiter);
    this.app.use(requestLogger);
    
    this.app.use(cors({
      origin: [config.server.clientUrl, 'http://localhost:3000'],
      credentials: true,
      optionsSuccessStatus: 200
    }));

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(cookieParser());
    
    const dataDir = path.dirname(config.database.path);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.app.use(session({
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.server.nodeEnv === 'production',
        httpOnly: true,
        maxAge: config.session.maxAge,
        sameSite: 'lax' // Changed to 'lax' for OAuth redirects
      },
      name: 'gts.sid'
    }));

    this.app.use(generateCSRFToken);
    this.app.use(validateContentType);

    if (config.server.nodeEnv === 'production') {
      this.app.use(express.static(path.join(__dirname, '../client/build')));
    }
  }

  private setupRoutes(): void {
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    this.app.get('/api/csrf-token', (req, res) => {
      res.json({ csrfToken: req.session?.csrfToken });
    });

    // API routes
    this.app.use('/auth', authRoutes);
    this.app.use('/api/google', googleRoutes);
    this.app.use('/api/smartsheet', smartsheetRoutes);
    this.app.use('/api/transfer', transferRoutes);

    if (config.server.nodeEnv === 'production') {
      this.app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../client/build/index.html'));
      });
    }

    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  private setupErrorHandling(): void {
    this.app.use(errorLogger);
    
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error('Unhandled error:', error);
      
      if (res.headersSent) {
        return next(error);
      }

      const statusCode = (error as any).statusCode || 500;
      const message = config.server.nodeEnv === 'production' 
        ? 'Internal server error' 
        : error.message;

      res.status(statusCode).json({ 
        error: message,
        ...(config.server.nodeEnv !== 'production' && { stack: error.stack })
      });
    });
  }

  public async start(): Promise<void> {
    try {
      await initializeDatabase();
      console.log('Database initialized successfully');

      if (config.server.nodeEnv === 'development') {
        // Use HTTP for development to avoid certificate issues
        this.httpServer = http.createServer(this.app);
        
        this.httpServer.listen(config.server.port, () => {
          console.log(`HTTP Server running on http://localhost:${config.server.port}`);
        });
      } else {
        this.httpServer = http.createServer(this.app);
        this.httpServer.listen(config.server.port, () => {
          console.log(`Server running on port ${config.server.port}`);
        });
      }

    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.httpsServer) {
      promises.push(new Promise((resolve) => {
        this.httpsServer!.close(() => resolve());
      }));
    }

    if (this.httpServer) {
      promises.push(new Promise((resolve) => {
        this.httpServer!.close(() => resolve());
      }));
    }

    await Promise.all(promises);
    console.log('Server stopped successfully');
  }
}

const server = new Server();

process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT, shutting down gracefully...');
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM, shutting down gracefully...');
  await server.stop();
  process.exit(0);
});

if (require.main === module) {
  server.start().catch(console.error);
}

export default server;