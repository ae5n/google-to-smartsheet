import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Validate required environment variables
function validateRequiredEnvVars() {
  const required = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET', 
    'SMARTSHEET_CLIENT_ID',
    'SMARTSHEET_CLIENT_SECRET',
    'SESSION_SECRET',
    'ENCRYPTION_KEY'
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
  },
  
  database: {
    path: process.env.DATABASE_PATH || './data/app.db',
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