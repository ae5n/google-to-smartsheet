import express from 'express';
import https from 'https';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import path from 'path';
import fs from 'fs';

import config from './config';
import {
  securityMiddleware,
  readRateLimiter,
  writeRateLimiter,
  deviceIdentity,
  generateCSRFToken,
  validateContentType
} from './middleware/security';
import { requestLogger, errorLogger } from './middleware/logging';
import database, { initializeDatabase } from './database';
import authRoutes from './routes/auth';
import googleRoutes from './routes/google';
import smartsheetRoutes from './routes/smartsheet';
import transferRoutes from './routes/transfer';
import { webSocketService } from './services/websocket';


class Server {
  private app: express.Application;
  private httpServer?: http.Server;
  private httpsServer?: https.Server;
  private io?: SocketIOServer;
  /** Shared with Socket.IO so sockets can authenticate as the logged-in user. */
  private sessionMiddleware: express.RequestHandler;

  constructor() {
    this.app = express();
    this.sessionMiddleware = session({
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.server.nodeEnv === 'production',
        httpOnly: true,
        maxAge: config.session.maxAge,
        sameSite: 'lax' // 'lax' so OAuth redirects keep the session
      },
      name: 'gts.sid'
    });
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupWebSocket(): void {
    if (!this.httpServer) return;

    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: [config.server.clientUrl, 'http://localhost:3000'],
        credentials: true
      },
      // Long-lived jobs mean idle stretches; keep the connection alive rather
      // than letting it drop and fall back to polling.
      pingInterval: 25000,
      pingTimeout: 60000,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: false
      }
    });

    // Reuse the Express session so socket connections carry the same identity.
    this.io.engine.use(this.sessionMiddleware);

    this.io.use((socket, next) => {
      const request = socket.request as any;
      const user = request.session?.user;

      if (!user?.id) {
        // Logged so a misconfigured session never fails silently: without this,
        // a broken session would just look like "live updates unavailable".
        console.warn(
          `🔌 Socket rejected — ${
            request.session ? 'no authenticated user in session' : 'session not readable on socket'
          }`
        );
        return next(new Error('unauthorized'));
      }
      (socket.data as any).userId = user.id;
      next();
    });

    this.io.on('connection', (socket) => {
      const userId = (socket.data as any).userId as string;

      // Rooms are namespaced by user, so a job's updates can only ever reach
      // the account that owns it. Previously any client could join any room
      // by guessing a job id and receive that job's full payload.
      socket.on('join-job', async (jobId: string, ack?: (result: any) => void) => {
        try {
          const job = await database.getTransferJobById(jobId);
          if (!job || job.userId !== userId) {
            ack?.({ ok: false, error: 'Job not found' });
            return;
          }
          await socket.join(`job-${jobId}`);
          ack?.({ ok: true });
        } catch (error: any) {
          ack?.({ ok: false, error: error.message });
        }
      });

      socket.on('leave-job', (jobId: string) => {
        void socket.leave(`job-${jobId}`);
      });
    });
  }

  public getWebSocketServer(): SocketIOServer | undefined {
    return this.io;
  }

  private setupMiddleware(): void {
    // Only trust as many proxy hops as actually exist. `true` would let any
    // client spoof X-Forwarded-For and impersonate another IP.
    this.app.set('trust proxy', config.server.trustProxy);

    this.app.use(securityMiddleware);
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

    this.app.use(this.sessionMiddleware);

    // Rate limiters run *after* cookies and session so they can key on the
    // authenticated user or signed device id rather than a shared IP.
    this.app.use(deviceIdentity);
    this.app.use(readRateLimiter);
    this.app.use(writeRateLimiter);

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

      // Setup WebSocket after HTTP server is created
      this.setupWebSocket();
      
      // Initialize WebSocket service with server instance
      if (this.io) {
        webSocketService.setServer(this.io);
      }
      
      console.log('🔌 WebSocket server initialized');

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