import { google } from 'googleapis';
import axios from 'axios';
import { googleAuthService } from '../auth/google';
import { encryptionService } from '../utils/encryption';
import { EncryptedTokens } from '../types';

export class GoogleDriveService {
  public async downloadImage(
    encryptedTokens: EncryptedTokens,
    imageUrl: string,
    driveFileId?: string
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    try {
      if (driveFileId) {
        return await this.downloadDriveFile(encryptedTokens, driveFileId);
      } else {
        return await this.downloadDirectUrl(imageUrl);
      }
    } catch (error: any) {
      if (error.code === 403) {
        throw new Error('Access denied to image file');
      }
      throw new Error(`Failed to download image: ${error.message}`);
    }
  }

  private async downloadDriveFile(
    encryptedTokens: EncryptedTokens,
    fileId: string
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const oauth2Client = googleAuthService.createOAuth2Client(encryptedTokens);
    const driveClient = google.drive({ version: 'v3', auth: oauth2Client });

    try {
      // Get file metadata first
      const metadataResponse = await driveClient.files.get({
        fileId,
        fields: 'name,mimeType,size'
      });

      const { name, mimeType, size } = metadataResponse.data;
      
      // Check file size (limit to 10MB)
      if (size && parseInt(size) > 10 * 1024 * 1024) {
        throw new Error('Image file too large (max 10MB)');
      }

      // Download file content
      const response = await driveClient.files.get({
        fileId,
        alt: 'media'
      }, {
        responseType: 'arraybuffer'
      });

      const buffer = Buffer.from(response.data as ArrayBuffer);
      
      return {
        buffer,
        mimeType: mimeType || 'image/jpeg',
        filename: name || `image_${fileId}.jpg`
      };
    } catch (error: any) {
      if (error.code === 403) {
        throw new Error('Access denied to Drive file');
      }
      if (error.code === 404) {
        throw new Error('Drive file not found');
      }
      throw error;
    }
  }

  private async downloadDirectUrl(
    imageUrl: string
  ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000, // 30 seconds timeout
        maxContentLength: 10 * 1024 * 1024, // 10MB limit
        headers: {
          'User-Agent': 'Google-Smartsheet-Transfer/1.0'
        }
      });

      const buffer = Buffer.from(response.data);
      const mimeType = response.headers['content-type'] || 'image/jpeg';
      
      // Extract filename from URL or use default
      const urlPath = new URL(imageUrl).pathname;
      const filename = urlPath.split('/').pop() || 'image.jpg';

      return {
        buffer,
        mimeType,
        filename
      };
    } catch (error: any) {
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error('Image URL not accessible');
      }
      if (error.response?.status === 403) {
        throw new Error('Access denied to image URL');
      }
      if (error.response?.status === 404) {
        throw new Error('Image not found at URL');
      }
      throw error;
    }
  }

  public async validateImageAccess(
    encryptedTokens: EncryptedTokens,
    imageUrl: string,
    driveFileId?: string
  ): Promise<{ accessible: boolean; error?: string }> {
    try {
      if (driveFileId) {
        const oauth2Client = googleAuthService.createOAuth2Client(encryptedTokens);
        const driveClient = google.drive({ version: 'v3', auth: oauth2Client });

        await driveClient.files.get({
          fileId: driveFileId,
          fields: 'id'
        });
      } else {
        await axios.head(imageUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Google-Smartsheet-Transfer/1.0'
          }
        });
      }

      return { accessible: true };
    } catch (error: any) {
      let errorMessage = 'Unknown error';
      
      if (error.code === 403) {
        errorMessage = 'Access denied';
      } else if (error.code === 404) {
        errorMessage = 'File not found';
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = 'URL not accessible';
      } else if (error.response?.status) {
        errorMessage = `HTTP ${error.response.status}`;
      }

      return { 
        accessible: false, 
        error: errorMessage 
      };
    }
  }

  public async batchValidateImages(
    encryptedTokens: EncryptedTokens,
    images: Array<{ url: string; driveFileId?: string }>
  ): Promise<Array<{ url: string; accessible: boolean; error?: string }>> {
    const results = await Promise.allSettled(
      images.map(async (image) => {
        const validation = await this.validateImageAccess(
          encryptedTokens,
          image.url,
          image.driveFileId
        );
        
        return {
          url: image.url,
          accessible: validation.accessible,
          error: validation.error
        };
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          url: images[index].url,
          accessible: false,
          error: result.reason?.message || 'Validation failed'
        };
      }
    });
  }
}

export const googleDriveService = new GoogleDriveService();