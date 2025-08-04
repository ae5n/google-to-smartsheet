import axios, { AxiosResponse } from 'axios';
import FormData from 'form-data';
import { smartsheetAuthService } from '../auth/smartsheet';
import { encryptionService } from '../utils/encryption';
import database from '../database';
import { 
  SmartsheetSheet, 
  SmartsheetColumn, 
  SmartsheetCellValue, 
  EncryptedTokens,
  ImageCache
} from '../types';

export class SmartsheetAPIService {
  private readonly baseUrl = 'https://api.smartsheet.com/2.0';

  public async getUserSheets(encryptedTokens: EncryptedTokens): Promise<SmartsheetSheet[]> {
    try {
      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'GET',
        '/sheets'
      );

      return response.data.map((sheet: any) => ({
        id: sheet.id,
        name: sheet.name,
        columns: [],
        permalink: sheet.permalink
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch Smartsheet sheets: ${error.message}`);
    }
  }

  public async getSheetDetails(encryptedTokens: EncryptedTokens, sheetId: number): Promise<SmartsheetSheet> {
    try {
      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'GET',
        `/sheets/${sheetId}`
      );

      const sheet = response;
      
      return {
        id: sheet.id,
        name: sheet.name,
        columns: sheet.columns.map((col: any, index: number) => ({
          id: col.id,
          title: col.title,
          type: col.type,
          primary: col.primary || false,
          index
        })),
        permalink: sheet.permalink
      };
    } catch (error: any) {
      throw new Error(`Failed to get sheet details: ${error.message}`);
    }
  }

  public async createSheet(
    encryptedTokens: EncryptedTokens,
    name: string,
    columns: Array<{ title: string; type: string; primary?: boolean }>
  ): Promise<SmartsheetSheet> {
    try {
      const sheetData = {
        name,
        columns: columns.map((col, index) => ({
          title: col.title,
          type: col.type || 'TEXT_NUMBER',
          primary: col.primary || index === 0
        }))
      };

      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'POST',
        '/sheets',
        sheetData
      );

      return {
        id: response.result.id,
        name: response.result.name,
        columns: response.result.columns.map((col: any, index: number) => ({
          id: col.id,
          title: col.title,
          type: col.type,
          primary: col.primary || false,
          index
        })),
        permalink: response.result.permalink
      };
    } catch (error: any) {
      throw new Error(`Failed to create sheet: ${error.message}`);
    }
  }

  public async addColumnsToSheet(
    encryptedTokens: EncryptedTokens,
    sheetId: number,
    columns: Array<{ title: string; type: string; index?: number }>
  ): Promise<SmartsheetColumn[]> {
    try {
      const columnData = columns.map(col => ({
        title: col.title,
        type: col.type || 'TEXT_NUMBER',
        index: col.index
      }));

      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'POST',
        `/sheets/${sheetId}/columns`,
        columnData
      );

      return response.result.map((col: any, index: number) => ({
        id: col.id,
        title: col.title,
        type: col.type,
        primary: col.primary || false,
        index: col.index || index
      }));
    } catch (error: any) {
      throw new Error(`Failed to add columns: ${error.message}`);
    }
  }

  public async uploadImage(
    encryptedTokens: EncryptedTokens,
    imageBuffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<string> {
    try {
      // Check cache first
      const imageHash = encryptionService.generateSecureHash(imageBuffer.toString('base64'));
      const cachedImage = await database.getCachedImage(imageHash);
      
      if (cachedImage) {
        return cachedImage.smartsheetImageId;
      }

      const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
      
      const formData = new FormData();
      formData.append('file', imageBuffer, {
        filename,
        contentType: mimeType
      });

      const response = await axios.post(`${this.baseUrl}/images`, formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${tokens.accessToken}`
        },
        maxContentLength: 10 * 1024 * 1024, // 10MB limit
        timeout: 60000 // 60 seconds timeout
      });

      const imageId = response.data.id;
      
      // Cache the image
      await database.cacheImage(imageHash, imageId, filename);
      
      return imageId;
    } catch (error: any) {
      if (error.response?.status === 413) {
        throw new Error('Image file too large');
      }
      if (error.response?.status === 415) {
        throw new Error('Unsupported image format');
      }
      throw new Error(`Failed to upload image: ${error.message}`);
    }
  }

  public async addRowsToSheet(
    encryptedTokens: EncryptedTokens,
    sheetId: number,
    rows: Array<{
      cells: SmartsheetCellValue[];
      toTop?: boolean;
      toBottom?: boolean;
    }>
  ): Promise<{ success: number; failed: number; errors: Array<{ row: number; error: string }> }> {
    try {
      const batchSize = 100; // Smartsheet API limit
      let totalSuccess = 0;
      let totalFailed = 0;
      const allErrors: Array<{ row: number; error: string }> = [];

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        
        try {
          const response = await smartsheetAuthService.makeAuthenticatedRequest(
            encryptedTokens,
            'POST',
            `/sheets/${sheetId}/rows`,
            batch.map(row => ({
              cells: row.cells,
              toBottom: row.toBottom !== false // Default to bottom
            }))
          );

          const result = response.result || response;
          if (Array.isArray(result)) {
            totalSuccess += result.length;
          } else {
            totalSuccess += batch.length;
          }
        } catch (error: any) {
          totalFailed += batch.length;
          
          // Log individual row errors
          for (let j = 0; j < batch.length; j++) {
            allErrors.push({
              row: i + j,
              error: error.message || 'Failed to insert row'
            });
          }
        }
      }

      return {
        success: totalSuccess,
        failed: totalFailed,
        errors: allErrors
      };
    } catch (error: any) {
      throw new Error(`Failed to add rows: ${error.message}`);
    }
  }

  public async addRowWithRetry(
    encryptedTokens: EncryptedTokens,
    sheetId: number,
    cells: SmartsheetCellValue[],
    maxRetries: number = 2
  ): Promise<{ success: boolean; error?: string }> {
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await smartsheetAuthService.makeAuthenticatedRequest(
          encryptedTokens,
          'POST',
          `/sheets/${sheetId}/rows`,
          [{
            cells,
            toBottom: true
          }]
        );

        return { success: true };
      } catch (error: any) {
        lastError = error.message;
        
        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    return { 
      success: false, 
      error: lastError || 'Failed after retries' 
    };
  }

  public async attachFileToSheet(
    encryptedTokens: EncryptedTokens,
    sheetId: number,
    imageBuffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<string> {
    try {
      const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
      
      const formData = new FormData();
      formData.append('file', imageBuffer, {
        filename,
        contentType: mimeType
      });

      const response = await axios.post(
        `${this.baseUrl}/sheets/${sheetId}/attachments`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'Authorization': `Bearer ${tokens.accessToken}`
          },
          maxContentLength: 10 * 1024 * 1024,
          timeout: 60000
        }
      );

      return response.data.id;
    } catch (error: any) {
      throw new Error(`Failed to attach file: ${error.message}`);
    }
  }

  public async validateSheetAccess(
    encryptedTokens: EncryptedTokens,
    sheetId: number
  ): Promise<boolean> {
    try {
      await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'GET',
        `/sheets/${sheetId}?include=objectValue`
      );
      return true;
    } catch (error: any) {
      if (error.response?.status === 403 || error.response?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  public async getSheetRowCount(encryptedTokens: EncryptedTokens, sheetId: number): Promise<number> {
    try {
      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'GET',
        `/sheets/${sheetId}?include=rowCount`
      );

      return response.totalRowCount || 0;
    } catch (error: any) {
      throw new Error(`Failed to get row count: ${error.message}`);
    }
  }

  public async deleteSheet(encryptedTokens: EncryptedTokens, sheetId: number): Promise<void> {
    try {
      await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'DELETE',
        `/sheets/${sheetId}`
      );
    } catch (error: any) {
      throw new Error(`Failed to delete sheet: ${error.message}`);
    }
  }
}

export const smartsheetAPIService = new SmartsheetAPIService();