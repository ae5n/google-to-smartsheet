import { google, sheets_v4 } from 'googleapis';
import { googleAuthService } from '../auth/google';
import { encryptionService } from '../utils/encryption';
import { GoogleSheet, GoogleSheetTab, GoogleCellValue, EncryptedTokens } from '../types';

export class GoogleSheetsService {
  private async createSheetsClient(encryptedTokens: EncryptedTokens): Promise<sheets_v4.Sheets> {
    const oauth2Client = googleAuthService.createOAuth2Client(encryptedTokens);
    return google.sheets({ version: 'v4', auth: oauth2Client });
  }

  public async getUserSpreadsheets(encryptedTokens: EncryptedTokens): Promise<GoogleSheet[]> {
    try {
      const tokens = encryptionService.decryptTokens(encryptedTokens.encryptedData);
      const driveClient = google.drive({ 
        version: 'v3', 
        auth: googleAuthService.createOAuth2Client(encryptedTokens) 
      });

      const response = await driveClient.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: 'files(id,name,modifiedTime)',
        orderBy: 'modifiedTime desc',
        pageSize: 100
      });

      const spreadsheets: GoogleSheet[] = [];

      for (const file of response.data.files || []) {
        if (file.id && file.name) {
          try {
            const sheets = await this.getSpreadsheetTabs(encryptedTokens, file.id);
            spreadsheets.push({
              spreadsheetId: file.id,
              title: file.name,
              sheets
            });
          } catch (error) {
            console.warn(`Failed to get tabs for spreadsheet ${file.id}:`, error);
          }
        }
      }

      return spreadsheets;
    } catch (error: any) {
      if (error.code === 401) {
        throw new Error('Google authentication expired');
      }
      throw new Error(`Failed to fetch spreadsheets: ${error.message}`);
    }
  }

  public async getSpreadsheetTabs(encryptedTokens: EncryptedTokens, spreadsheetId: string): Promise<GoogleSheetTab[]> {
    try {
      const sheetsClient = await this.createSheetsClient(encryptedTokens);
      
      const response = await sheetsClient.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
      });

      const sheets = response.data.sheets || [];
      
      return sheets.map(sheet => ({
        sheetId: sheet.properties?.sheetId || 0,
        title: sheet.properties?.title || 'Untitled',
        gridProperties: {
          rowCount: sheet.properties?.gridProperties?.rowCount || 0,
          columnCount: sheet.properties?.gridProperties?.columnCount || 0
        }
      }));
    } catch (error: any) {
      throw new Error(`Failed to get spreadsheet tabs: ${error.message}`);
    }
  }

  public async getSpreadsheetData(
    encryptedTokens: EncryptedTokens,
    spreadsheetId: string,
    sheetTabs: string[],
    includeFormulas: boolean = true,
    headerRowIndex?: number
  ): Promise<{ [tabName: string]: GoogleCellValue[][] }> {
    try {
      const sheetsClient = await this.createSheetsClient(encryptedTokens);
      const data: { [tabName: string]: GoogleCellValue[][] } = {};

      for (const tabName of sheetTabs) {
        try {
          // If headerRowIndex is provided, get data starting from that row
          // Otherwise get all data and let the caller handle it
          const range = headerRowIndex !== undefined 
            ? `'${tabName}'!A${headerRowIndex + 1}:ZZ` // Get from header row to end, all columns and rows
            : `'${tabName}'`;
          
          
          const valueRenderOption = includeFormulas ? 'FORMULA' : 'FORMATTED_VALUE';
          
          const [valuesResponse, formulasResponse] = await Promise.all([
            sheetsClient.spreadsheets.values.get({
              spreadsheetId,
              range,
              valueRenderOption: 'FORMATTED_VALUE'
            }),
            includeFormulas ? sheetsClient.spreadsheets.values.get({
              spreadsheetId,
              range,
              valueRenderOption: 'FORMULA'
            }) : Promise.resolve({ data: { values: [] } })
          ]);

          const values = valuesResponse.data.values || [];
          const formulas = formulasResponse.data.values || [];
          
          const processedData = this.processSheetData(values, formulas);
          data[tabName] = processedData;
        } catch (error) {
          console.warn(`Failed to get data for tab ${tabName}:`, error);
          data[tabName] = [];
        }
      }

      return data;
    } catch (error: any) {
      throw new Error(`Failed to get spreadsheet data: ${error.message}`);
    }
  }

  private processSheetData(values: any[][], formulas: any[][]): GoogleCellValue[][] {
    const processedData: GoogleCellValue[][] = [];

    // Determine the maximum number of columns from header row or any row
    const maxColumns = Math.max(
      ...values.map(row => row?.length || 0),
      ...formulas.map(row => row?.length || 0)
    );


    for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
      const row = values[rowIndex] || [];
      const formulaRow = formulas[rowIndex] || [];
      const processedRow: GoogleCellValue[] = [];

      // Process all columns up to maxColumns, not just row.length
      for (let colIndex = 0; colIndex < maxColumns; colIndex++) {
        const cellValue = row[colIndex] || ''; // Default to empty string for missing cells
        const formula = formulaRow[colIndex] || '';
        
        const cellData: GoogleCellValue = {
          value: cellValue,
          formula: formula !== cellValue ? formula : undefined,
          isImage: false
        };

        if (formula && typeof formula === 'string') {
          const imageMatch = this.extractImageFromFormula(formula);
          if (imageMatch) {
            cellData.isImage = true;
            cellData.imageUrl = imageMatch.url;
            cellData.imageId = imageMatch.id;
          }

          const hyperlinkMatch = this.extractHyperlinkFromFormula(formula);
          if (hyperlinkMatch && !cellData.isImage) {
            cellData.hyperlink = hyperlinkMatch;
          }
        }

        processedRow.push(cellData);
      }

      processedData.push(processedRow);
    }

    return processedData;
  }

  private extractImageFromFormula(formula: string): { url: string; id?: string } | null {
    const imageRegex = /=IMAGE\s*\(\s*"([^"]+)"\s*[^)]*\)/i;
    const hyperlinkImageRegex = /=HYPERLINK\s*\([^,]+,\s*IMAGE\s*\(\s*"([^"]+)"\s*[^)]*\)\s*\)/i;
    
    let match = formula.match(imageRegex);
    if (!match) {
      match = formula.match(hyperlinkImageRegex);
    }

    if (match && match[1]) {
      const url = match[1];
      
      const driveFileMatch = url.match(/(?:drive\.google\.com\/file\/d\/|id=)([a-zA-Z0-9_-]+)/);
      if (driveFileMatch) {
        return {
          url,
          id: driveFileMatch[1]
        };
      }
      
      return { url };
    }

    return null;
  }

  private extractHyperlinkFromFormula(formula: string): string | null {
    const hyperlinkRegex = /=HYPERLINK\s*\(\s*"([^"]+)"\s*[^)]*\)/i;
    const match = formula.match(hyperlinkRegex);
    
    if (match && match[1] && !formula.includes('IMAGE(')) {
      return match[1];
    }

    return null;
  }

  public async getSpreadsheetHeaders(
    encryptedTokens: EncryptedTokens,
    spreadsheetId: string,
    sheetTab: string
  ): Promise<string[]> {
    try {
      const sheetsClient = await this.createSheetsClient(encryptedTokens);
      
      // Get first 5 rows to analyze for the best header row
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTab}'!1:5`,
        valueRenderOption: 'FORMATTED_VALUE'
      });

      const rows = response.data.values || [];
      const bestHeaderRow = this.findBestHeaderRow(rows);
      
      console.log(`📋 Headers detected at row ${bestHeaderRow.rowIndex + 1} (${bestHeaderRow.headers.length} columns):`, bestHeaderRow.headers.slice(0, 10).join(', ') + (bestHeaderRow.headers.length > 10 ? '...' : ''));
      
      return bestHeaderRow.headers;
    } catch (error: any) {
      throw new Error(`Failed to get spreadsheet headers: ${error.message}`);
    }
  }

  public async getSpreadsheetHeadersWithRowIndex(
    encryptedTokens: EncryptedTokens,
    spreadsheetId: string,
    sheetTab: string
  ): Promise<{ headers: string[]; headerRowIndex: number }> {
    try {
      const sheetsClient = await this.createSheetsClient(encryptedTokens);
      
      // Get first 5 rows to analyze for the best header row
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTab}'!1:5`,
        valueRenderOption: 'FORMATTED_VALUE'
      });

      const rows = response.data.values || [];
      const bestHeaderRow = this.findBestHeaderRow(rows);
      
      console.log(`📋 Headers detected at row ${bestHeaderRow.rowIndex + 1} (${bestHeaderRow.headers.length} columns):`, bestHeaderRow.headers.slice(0, 10).join(', ') + (bestHeaderRow.headers.length > 10 ? '...' : ''));
      
      return {
        headers: bestHeaderRow.headers,
        headerRowIndex: bestHeaderRow.rowIndex
      };
    } catch (error: any) {
      throw new Error(`Failed to get spreadsheet headers with row index: ${error.message}`);
    }
  }

  private findBestHeaderRow(rows: any[][]): { headers: string[]; rowIndex: number } {
    let bestRow = { headers: [] as string[], rowIndex: 0, score: -1 };
    
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 5); rowIndex++) {
      const row = rows[rowIndex] || [];
      const processedHeaders = this.processHeaderRow(row);
      const score = this.scoreHeaderRow(processedHeaders);
      
      if (score > bestRow.score) {
        bestRow = {
          headers: processedHeaders,
          rowIndex,
          score
        };
      }
    }
    
    // If no good headers found, create generic column names
    if (bestRow.score <= 0 && rows.length > 0) {
      const maxColumns = Math.max(...rows.map(row => row.length));
      bestRow.headers = Array.from({ length: maxColumns }, (_, i) => `Column ${i + 1}`);
    }
    
    return bestRow;
  }

  private processHeaderRow(row: any[]): string[] {
    return row.map((cell, index) => {
      if (!cell || typeof cell !== 'string') {
        return `Column ${index + 1}`;
      }
      
      const cleaned = String(cell).trim();
      
      // Skip common non-header patterns
      if (this.isNonHeaderContent(cleaned)) {
        return `Column ${index + 1}`;
      }
      
      return cleaned || `Column ${index + 1}`;
    });
  }

  private scoreHeaderRow(headers: string[]): number {
    let score = 0;
    const nonGenericHeaders = headers.filter(h => !h.startsWith('Column '));
    
    // Base score: number of non-generic headers
    score += nonGenericHeaders.length * 2;
    
    // Bonus for headers that look like actual column names
    for (const header of nonGenericHeaders) {
      // Short, concise headers get bonus points
      if (header.length >= 2 && header.length <= 20) {
        score += 1;
      }
      
      // Headers with common column patterns
      if (this.isLikelyColumnHeader(header)) {
        score += 2;
      }
      
      // Penalty for very long headers (likely content, not headers)
      if (header.length > 50) {
        score -= 1;
      }
    }
    
    // Bonus for having a reasonable number of headers (not too few, not too many)
    const totalHeaders = headers.length;
    if (totalHeaders >= 3 && totalHeaders <= 50) {
      score += 1;
    }
    
    return score;
  }

  private isNonHeaderContent(text: string): boolean {
    // Skip empty or whitespace-only
    if (!text || text.trim().length === 0) {
      return true;
    }
    
    // Skip common non-header patterns
    const nonHeaderPatterns = [
      /^\d+$/, // Just numbers
      /^[A-Z]\d+$/, // Cell references like A1, B2
      /^Page \d+/i, // Page numbers
      /^Total|^Sum|^Average/i, // Summary rows
      /^Note:|^Notes:/i, // Notes sections
    ];
    
    return nonHeaderPatterns.some(pattern => pattern.test(text));
  }

  private isLikelyColumnHeader(text: string): boolean {
    const headerPatterns = [
      /^(id|name|title|description|type|status|date|time|amount|price|quantity|total)$/i,
      /^(item|product|service|category|group|department|location|contact|email|phone)$/i,
      /^(address|city|state|country|zip|code|number|reference|comment|note)$/i,
      /\b(id|name|date|time|status|type|code)\b/i,
    ];
    
    return headerPatterns.some(pattern => pattern.test(text));
  }

  public async validateSpreadsheetAccess(
    encryptedTokens: EncryptedTokens,
    spreadsheetId: string
  ): Promise<boolean> {
    try {
      const sheetsClient = await this.createSheetsClient(encryptedTokens);
      
      await sheetsClient.spreadsheets.get({
        spreadsheetId,
        fields: 'properties(title)'
      });

      return true;
    } catch (error: any) {
      if (error.code === 403) {
        return false;
      }
      throw error;
    }
  }
}

export const googleSheetsService = new GoogleSheetsService();