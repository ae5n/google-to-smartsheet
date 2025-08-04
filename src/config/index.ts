import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    httpsPort: parseInt(process.env.HTTPS_PORT || '3443', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL || 'https://localhost:3443',
    clientUrl: process.env.CLIENT_URL || 'https://localhost:3000',
  },
  
  database: {
    path: process.env.DATABASE_PATH || './data/app.db',
    encryptionKey: process.env.ENCRYPTION_KEY || 'your-256-bit-encryption-key-here',
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
    redirectUri: `${process.env.BASE_URL || 'https://localhost:3443'}/auth/google/callback`
  },
  
  smartsheet: {
    clientId: process.env.SMARTSHEET_CLIENT_ID || '',
    clientSecret: process.env.SMARTSHEET_CLIENT_SECRET || '',
    scopes: ['READ_SHEETS', 'WRITE_SHEETS', 'SHARE_SHEETS'],
    redirectUri: `${process.env.BASE_URL || 'https://localhost:3443'}/auth/smartsheet/callback`
  },
  
  session: {
    secret: process.env.SESSION_SECRET || 'your-session-secret-key-here',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
  
  https: {
    keyPath: process.env.HTTPS_KEY_PATH || './certs/server.key',
    certPath: process.env.HTTPS_CERT_PATH || './certs/server.crt',
  },
  
  security: {
    csrfSecret: process.env.CSRF_SECRET || 'your-csrf-secret-here',
    jwtSecret: process.env.JWT_SECRET || 'your-jwt-secret-here',
  },
  
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    tempDir: process.env.TEMP_DIR || './temp',
  }
};

export default config;