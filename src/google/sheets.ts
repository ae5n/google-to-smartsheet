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
    includeFormulas: boolean = true
  ): Promise<{ [tabName: string]: GoogleCellValue[][] }> {
    try {
      const sheetsClient = await this.createSheetsClient(encryptedTokens);
      const data: { [tabName: string]: GoogleCellValue[][] } = {};

      for (const tabName of sheetTabs) {
        try {
          const range = `'${tabName}'`;
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

    for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
      const row = values[rowIndex] || [];
      const formulaRow = formulas[rowIndex] || [];
      const processedRow: GoogleCellValue[] = [];

      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        const cellValue = row[colIndex];
        const formula = formulaRow[colIndex];
        
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
      
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTab}'!1:1`,
        valueRenderOption: 'FORMATTED_VALUE'
      });

      const headerRow = response.data.values?.[0] || [];
      return headerRow.map((header, index) => 
        header ? String(header).trim() : `Column ${index + 1}`
      );
    } catch (error: any) {
      throw new Error(`Failed to get spreadsheet headers: ${error.message}`);
    }
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