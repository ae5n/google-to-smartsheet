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

  private logApiResponse(endpoint: string, method: string, response: any, error?: any): void {
    // Only log transfer-related operations and errors
    const isTransferRelated = endpoint.includes('/sheets') && method === 'POST';
    const hasError = !!error;
    
    if (!isTransferRelated && !hasError) {
      return; // Skip logging for routine operations
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      endpoint,
      method,
      status: error ? 'error' : 'success',
      statusCode: response?.status || error?.response?.status,
      error: error ? {
        message: error.message,
        code: error.code,
        response: error.response?.data
      } : undefined
    };

    console.log(`[Smartsheet API] ${method} ${endpoint}:`, JSON.stringify(logEntry, null, 2));
  }

  public async getUserSheets(encryptedTokens: EncryptedTokens): Promise<SmartsheetSheet[]> {
    try {
      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'GET',
        '/sheets'
      );

      this.logApiResponse('/sheets', 'GET', response);

      return response.data.map((sheet: any) => ({
        id: sheet.id,
        name: sheet.name,
        columns: [],
        permalink: sheet.permalink
      }));
    } catch (error: any) {
      this.logApiResponse('/sheets', 'GET', null, error);
      throw new Error(`Failed to fetch Smartsheet sheets: ${error.message}`);
    }
  }

  public async getUserWorkspaces(encryptedTokens: EncryptedTokens): Promise<any[]> {
    try {
      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'GET',
        '/workspaces'
      );

      this.logApiResponse('/workspaces', 'GET', response);

      return response.data.map((workspace: any) => ({
        id: workspace.id,
        name: workspace.name,
        permalink: workspace.permalink
      }));
    } catch (error: any) {
      this.logApiResponse('/workspaces', 'GET', null, error);
      throw new Error(`Failed to fetch workspaces: ${error.message}`);
    }
  }

  public async getWorkspaceFolders(encryptedTokens: EncryptedTokens, workspaceId: number): Promise<any[]> {
    try {
      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'GET',
        `/workspaces/${workspaceId}`
      );

      this.logApiResponse(`/workspaces/${workspaceId}`, 'GET', response);

      return (response.folders || []).map((folder: any) => ({
        id: folder.id,
        name: folder.name,
        permalink: folder.permalink
      }));
    } catch (error: any) {
      this.logApiResponse(`/workspaces/${workspaceId}`, 'GET', null, error);
      throw new Error(`Failed to fetch workspace folders: ${error.message}`);
    }
  }

  public async createFolderInWorkspace(
    encryptedTokens: EncryptedTokens,
    workspaceId: number,
    folderName: string
  ): Promise<any> {
    try {
      const folderData = {
        name: folderName
      };

      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'POST',
        `/workspaces/${workspaceId}/folders`,
        folderData
      );

      this.logApiResponse(`/workspaces/${workspaceId}/folders`, 'POST', response);

      return {
        id: response.result.id,
        name: response.result.name,
        permalink: response.result.permalink
      };
    } catch (error: any) {
      this.logApiResponse(`/workspaces/${workspaceId}/folders`, 'POST', null, error);
      throw new Error(`Failed to create folder: ${error.message}`);
    }
  }

  public async getSheetDetails(encryptedTokens: EncryptedTokens, sheetId: number): Promise<SmartsheetSheet> {
    try {
      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'GET',
        `/sheets/${sheetId}`
      );

      this.logApiResponse(`/sheets/${sheetId}`, 'GET', response);

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
      this.logApiResponse(`/sheets/${sheetId}`, 'GET', null, error);
      throw new Error(`Failed to get sheet details: ${error.message}`);
    }
  }

  public async createSheet(
    encryptedTokens: EncryptedTokens,
    name: string,
    columns: Array<{ title: string; type: string; primary?: boolean }>,
    workspaceId?: number,
    folderId?: number
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

      console.log(`📋 Creating sheet "${sheetData.name}" with ${sheetData.columns.length} columns`);

      let endpoint = '/sheets';
      if (folderId) {
        endpoint = `/folders/${folderId}/sheets`;
      } else if (workspaceId) {
        endpoint = `/workspaces/${workspaceId}/sheets`;
      }

      const response = await smartsheetAuthService.makeAuthenticatedRequest(
        encryptedTokens,
        'POST',
        endpoint,
        sheetData
      );

      this.logApiResponse(endpoint, 'POST', response);

      console.log(`✅ Smartsheet created: ${response.result.name} (ID: ${response.result.id})`);

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
      const endpoint = folderId ? `/folders/${folderId}/sheets` : 
                     workspaceId ? `/workspaces/${workspaceId}/sheets` : '/sheets';
      this.logApiResponse(endpoint, 'POST', null, error);
      
      // If folder creation fails, try workspace root as fallback
      if (folderId && error.response?.status >= 400) {
        console.log('🔄 Retrying in workspace root...');
        try {
          return await this.createSheet(encryptedTokens, name, columns, workspaceId, undefined);
        } catch (fallbackError) {
          console.log('❌ Workspace fallback failed');
        }
      }
      
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

  public async addImageToCell(
    encryptedTokens: EncryptedTokens,
    sheetId: number,
    rowId: number,
    columnId: number,
    imageBuffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<string> {
    try {
      const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);

      const response = await axios.post(
        `${this.baseUrl}/sheets/${sheetId}/rows/${rowId}/columns/${columnId}/cellimages`,
        imageBuffer,
        {
          headers: {
            'Authorization': `Bearer ${tokens.accessToken}`,
            'Content-Type': mimeType,
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': imageBuffer.length.toString()
          },
          maxContentLength: 10 * 1024 * 1024, // 10MB limit
          timeout: 60000 // 60 seconds timeout
        }
      );

      return response.data.id;
    } catch (error: any) {
      if (error.response?.status === 413) {
        throw new Error('Image file too large');
      }
      if (error.response?.status === 415) {
        throw new Error('Unsupported image format');
      }
      throw new Error(`Failed to add image to cell: ${error.message}`);
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
  ): Promise<{ success: number; failed: number; errors: Array<{ row: number; error: string }>; result?: any[] }> {
    try {
      const batchSize = 100; // Smartsheet API limit
      let totalSuccess = 0;
      let totalFailed = 0;
      const allErrors: Array<{ row: number; error: string }> = [];
      let allInsertedRows: any[] = [];

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
            allInsertedRows = allInsertedRows.concat(result);
          } else {
            totalSuccess += batch.length;
          }
        } catch (error: any) {
          totalFailed += batch.length;
          
          // Enhanced error logging for 400 errors
          console.error(`❌ Smartsheet row insertion failed:`, {
            status: error.response?.status,
            statusText: error.response?.statusText,
            errorResponse: error.response?.data
          });
          
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
        errors: allErrors,
        result: allInsertedRows
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