import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import config from '../config';

export async function ensureSSLCertificates(): Promise<{ key: string; cert: string }> {
  const keyPath = path.resolve(config.https.keyPath);
  const certPath = path.resolve(config.https.certPath);
  const certsDir = path.dirname(keyPath);

  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.log('Generating self-signed SSL certificates for development...');
    
    try {
      execSync(
        `openssl req -x509 -newkey rsa:4096 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"`,
        { stdio: 'inherit' }
      );
      console.log('SSL certificates generated successfully');
    } catch (error) {
      console.error('Failed to generate SSL certificates. Please install OpenSSL or create certificates manually.');
      throw error;
    }
  }

  return {
    key: fs.readFileSync(keyPath, 'utf8'),
    cert: fs.readFileSync(certPath, 'utf8')
  };
}