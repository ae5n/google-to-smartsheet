import * as dotenv from 'dotenv';

dotenv.config();

const nonNegativeInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

// Validate required environment variables
function validateRequiredEnvVars() {
  const required = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET', 
    'SMARTSHEET_CLIENT_ID',
    'SMARTSHEET_CLIENT_SECRET',
    'SESSION_SECRET',
    'ENCRYPTION_KEY',
    'DATABASE_URL'
  ];

  const missing = required.filter(key => !process.env[key] || process.env[key]?.trim() === '');
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`  - ${key}`));
    console.error('\nPlease set these in your .env file or environment variables.');
    process.exit(1);
  }

  // Validate encryption key length (should be 32 bytes for AES-256)
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey && encryptionKey.length < 32) {
    console.error('❌ ENCRYPTION_KEY must be at least 32 characters for AES-256 encryption');
    process.exit(1);
  }

  // Validate session secret length
  const sessionSecret = process.env.SESSION_SECRET;
  if (sessionSecret && sessionSecret.length < 32) {
    console.error('❌ SESSION_SECRET should be at least 32 characters for security');
    process.exit(1);
  }

  console.log('✅ All required environment variables are configured');
}

// Run validation in production
if (process.env.NODE_ENV === 'production') {
  validateRequiredEnvVars();
}

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    httpsPort: parseInt(process.env.HTTPS_PORT || '3443', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL || 'http://localhost:3001',
    clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
    /**
     * Number of reverse proxies in front of this app, or 'loopback'.
     * Set TRUST_PROXY=1 behind a single nginx/ALB, 2 behind Cloudflare+nginx.
     * Never set it higher than the real hop count: each extra hop lets a
     * client forge one more X-Forwarded-For entry.
     */
    trustProxy: process.env.TRUST_PROXY
      ? (Number.isNaN(Number(process.env.TRUST_PROXY))
          ? process.env.TRUST_PROXY
          : Number(process.env.TRUST_PROXY))
      : 'loopback',
  },
  
  database: {
    /** Postgres connection string, e.g. the pooled URL Neon gives you. */
    url: process.env.DATABASE_URL || '',
    poolSize: Math.max(1, nonNegativeInt(process.env.DATABASE_POOL_SIZE, 10)),
    /** A running transfer with no persisted progress for this long is treated
     * as interrupted. It is never replayed automatically because Smartsheet
     * inserts are not safely idempotent. */
    staleTransferMinutes: nonNegativeInt(process.env.STALE_TRANSFER_MINUTES, 15),
    /** Optional terminal-job retention. Zero preserves history indefinitely. */
    transferHistoryRetentionDays: nonNegativeInt(
      process.env.TRANSFER_HISTORY_RETENTION_DAYS,
      0
    ),
    encryptionKey: process.env.ENCRYPTION_KEY!,
  },
  
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ],
    redirectUri: `${process.env.BASE_URL || 'http://localhost:3001'}/auth/google/callback`
  },
  
  smartsheet: {
    clientId: process.env.SMARTSHEET_CLIENT_ID || '',
    clientSecret: process.env.SMARTSHEET_CLIENT_SECRET || '',
    scopes: ['READ_SHEETS', 'WRITE_SHEETS', 'CREATE_SHEETS', 'SHARE_SHEETS'],
    redirectUri: `${process.env.BASE_URL || 'http://localhost:3001'}/auth/smartsheet/callback`
  },
  
  session: {
    secret: process.env.SESSION_SECRET!,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
  
  https: {
    keyPath: process.env.HTTPS_KEY_PATH || './certs/server.key',
    certPath: process.env.HTTPS_CERT_PATH || './certs/server.crt',
  },
  
  security: {
    csrfSecret: process.env.CSRF_SECRET || 'default-csrf-secret',
    jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret',
  },
  
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    tempDir: process.env.TEMP_DIR || './temp',
  }
};

export default config;
