import CryptoJS from 'crypto-js';
import config from '../config';

export class EncryptionService {
  private readonly encryptionKey: string;

  constructor() {
    this.encryptionKey = config.database.encryptionKey;
    if (this.encryptionKey === 'your-256-bit-encryption-key-here') {
      throw new Error('Please set a proper ENCRYPTION_KEY in your environment variables');
    }
  }

  encrypt(data: string): string {
    try {
      const encrypted = CryptoJS.AES.encrypt(data, this.encryptionKey).toString();
      return encrypted;
    } catch (error) {
      throw new Error('Failed to encrypt data');
    }
  }

  decrypt(encryptedData: string): string {
    try {
      const decrypted = CryptoJS.AES.decrypt(encryptedData, this.encryptionKey);
      const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
      
      if (!plaintext) {
        throw new Error('Failed to decrypt data - invalid key or corrupted data');
      }
      
      return plaintext;
    } catch (error) {
      throw new Error('Failed to decrypt data');
    }
  }

  encryptTokens(tokens: { accessToken: string; refreshToken?: string; expiryDate?: number }): string {
    try {
      const tokenData = JSON.stringify(tokens);
      return this.encrypt(tokenData);
    } catch (error) {
      throw new Error('Failed to encrypt tokens');
    }
  }

  decryptTokens(encryptedTokens: string): { accessToken: string; refreshToken?: string; expiryDate?: number } {
    try {
      const decryptedData = this.decrypt(encryptedTokens);
      return JSON.parse(decryptedData);
    } catch (error) {
      throw new Error('Failed to decrypt tokens');
    }
  }

  generateSecureHash(data: string): string {
    return CryptoJS.SHA256(data).toString();
  }

  verifyHash(data: string, hash: string): boolean {
    return this.generateSecureHash(data) === hash;
  }
}

export const encryptionService = new EncryptionService();