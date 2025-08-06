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
          
          const [valuesResponse, formulasResponse, sheetDataResponse] = await Promise.all([
            sheetsClient.spreadsheets.values.get({
              spreadsheetId,
              range,
              valueRenderOption: 'FORMATTED_VALUE'
            }),
            includeFormulas ? sheetsClient.spreadsheets.values.get({
              spreadsheetId,
              range,
              valueRenderOption: 'FORMULA'
            }) : Promise.resolve({ data: { values: [] } }),
            // Get sheet data with embedded objects to detect images
            sheetsClient.spreadsheets.get({
              spreadsheetId,
              ranges: [range],
              includeGridData: true,
              fields: 'sheets(data(rowData(values(effectiveValue,formattedValue,hyperlink,textFormatRuns,note))))'
            }).catch(() => ({ data: { sheets: [] } })) // Fallback if this fails
          ]);

          const values = valuesResponse.data.values || [];
          const formulas = formulasResponse.data.values || [];
          const embeddedData = sheetDataResponse.data.sheets?.[0]?.data?.[0]?.rowData || [];
          
          const processedData = this.processSheetData(values, formulas, embeddedData);
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

  private processSheetData(values: any[][], formulas: any[][], embeddedData: any[] = []): GoogleCellValue[][] {
    const processedData: GoogleCellValue[][] = [];

    // Determine the maximum number of columns from header row or any row
    const maxColumns = Math.max(
      ...values.map(row => row?.length || 0),
      ...formulas.map(row => row?.length || 0),
      ...embeddedData.map(row => row?.values?.length || 0)
    );


    for (let rowIndex = 0; rowIndex < Math.max(values.length, embeddedData.length); rowIndex++) {
      const row = values[rowIndex] || [];
      const formulaRow = formulas[rowIndex] || [];
      const embeddedRow = embeddedData[rowIndex] || {};
      const processedRow: GoogleCellValue[] = [];

      // Process all columns up to maxColumns, not just row.length
      for (let colIndex = 0; colIndex < maxColumns; colIndex++) {
        const cellValue = row[colIndex] || ''; // Default to empty string for missing cells
        const formula = formulaRow[colIndex] || '';
        const embeddedCell = embeddedRow.values?.[colIndex];
        
        const cellData: GoogleCellValue = {
          value: cellValue,
          formula: formula !== cellValue ? formula : undefined,
          isImage: false
        };

        // Check formula for images first
        if (formula && typeof formula === 'string') {
          const imageMatch = this.extractImageFromFormula(formula);
          if (imageMatch) {
            cellData.isImage = true;
            cellData.imageUrl = imageMatch.url;
            cellData.imageId = imageMatch.id;
          }

          const hyperlinkMatch = this.extractHyperlinkFromFormula(formula);
          if (hyperlinkMatch && !cellData.isImage) {
            // Check if hyperlink contains a Google Drive image
            if (hyperlinkMatch.includes('drive.google.com/file/d/')) {
              const driveId = hyperlinkMatch.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1];
              if (driveId) {
                cellData.isImage = true;
                cellData.imageUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
                cellData.imageId = driveId;
              }
            } else {
              cellData.hyperlink = hyperlinkMatch;
            }
          }
        }

        // Check for embedded images in cell metadata (for directly inserted images)
        if (!cellData.isImage && embeddedCell) {
          const embeddedImageMatch = this.extractEmbeddedImage(embeddedCell);
          if (embeddedImageMatch) {
            cellData.isImage = true;
            cellData.imageUrl = embeddedImageMatch.url;
            cellData.imageId = embeddedImageMatch.id;
            // If there's no visible value but there's an image, show placeholder
            if (!cellData.value || cellData.value === '') {
              cellData.value = 'Embedded Image';
            }
          }
        }

        // Check cell value for Google Drive image links (for directly imported images with URLs)
        if (!cellData.isImage && cellValue && typeof cellValue === 'string') {
          const driveImageMatch = this.extractDriveImageFromValue(cellValue);
          if (driveImageMatch) {
            cellData.isImage = true;
            cellData.imageUrl = driveImageMatch.url;
            cellData.imageId = driveImageMatch.id;
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

  public async getHeaderPreview(
    encryptedTokens: EncryptedTokens,
    spreadsheetId: string,
    sheetTab: string
  ): Promise<{
    rows: string[][];
    detectedHeaderRow: number;
    detectedHeaders: string[];
    rowOptions: Array<{ rowIndex: number; preview: string[]; score: number }>;
  }> {
    try {
      const sheetsClient = await this.createSheetsClient(encryptedTokens);
      
      // Get first 10 rows for header selection
      const response = await sheetsClient.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetTab}'!1:10`,
        valueRenderOption: 'FORMATTED_VALUE'
      });

      const rows = response.data.values || [];
      
      // Find the best header row using existing algorithm
      const bestHeaderRow = this.findBestHeaderRow(rows);
      
      // Score all rows to give users options
      const rowOptions: Array<{ rowIndex: number; preview: string[]; score: number }> = [];
      
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i] || [];
        const processedHeaders = this.processHeaderRow(row);
        const score = this.scoreHeaderRow(processedHeaders, rows, i);
        
        rowOptions.push({
          rowIndex: i,
          preview: processedHeaders.slice(0, 10), // Show first 10 columns
          score
        });
      }
      
      // Sort by score (highest first)
      rowOptions.sort((a, b) => b.score - a.score);
      
      return {
        rows: rows.map(row => (row || []).slice(0, 15)), // Show first 15 columns for preview
        detectedHeaderRow: bestHeaderRow.rowIndex,
        detectedHeaders: bestHeaderRow.headers.slice(0, 15),
        rowOptions: rowOptions.slice(0, 5) // Show top 5 candidates
      };
    } catch (error: any) {
      throw new Error(`Failed to get header preview: ${error.message}`);
    }
  }

  private findBestHeaderRow(rows: any[][]): { headers: string[]; rowIndex: number } {
    let bestRow = { headers: [] as string[], rowIndex: 0, score: -1 };
    
    // Check up to 10 rows for better header detection
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex++) {
      const row = rows[rowIndex] || [];
      const processedHeaders = this.processHeaderRow(row);
      const score = this.scoreHeaderRow(processedHeaders, rows, rowIndex);
      
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

  private scoreHeaderRow(headers: string[], allRows: any[][], rowIndex: number): number {
    let score = 0;
    const nonGenericHeaders = headers.filter(h => !h.startsWith('Column '));
    
    // Base score: number of non-generic headers
    score += nonGenericHeaders.length * 2;
    
    // Bonus for headers that look like actual column names
    for (const header of nonGenericHeaders) {
      // Short, concise headers get bonus points
      if (header.length >= 2 && header.length <= 30) {
        score += 1;
      }
      
      // Headers with common column patterns
      if (this.isLikelyColumnHeader(header)) {
        score += 3;
      }
      
      // Penalty for very long headers (likely content, not headers)
      if (header.length > 50) {
        score -= 2;
      }
    }
    
    // Analyze data consistency below this row
    if (rowIndex < allRows.length - 1) {
      const nextRow = allRows[rowIndex + 1];
      if (nextRow && nextRow.length > 0) {
        // Check if next row has different data types (suggesting this is a header)
        let hasDataBelow = false;
        for (let i = 0; i < Math.min(headers.length, nextRow.length); i++) {
          const headerCell = headers[i];
          const dataCell = nextRow[i];
          
          // If header is text and data below is different type, likely a header
          if (headerCell && !headerCell.startsWith('Column ') && dataCell) {
            const isHeaderText = isNaN(Number(headerCell));
            const isDataNumber = !isNaN(Number(dataCell));
            
            if (isHeaderText && isDataNumber) {
              score += 2; // Strong indicator
              hasDataBelow = true;
            } else if (dataCell && dataCell !== '') {
              hasDataBelow = true;
            }
          }
        }
        
        if (hasDataBelow) {
          score += 3;
        }
      }
    }
    
    // Check if row is mostly filled (headers usually have most columns filled)
    const filledCells = headers.filter(h => h && !h.startsWith('Column ')).length;
    const fillRatio = headers.length > 0 ? filledCells / headers.length : 0;
    if (fillRatio > 0.7) {
      score += 3;
    }
    
    // Bonus for having a reasonable number of headers
    const totalHeaders = headers.length;
    if (totalHeaders >= 3 && totalHeaders <= 50) {
      score += 2;
    }
    
    // Penalty if row appears to be data (all numbers or dates)
    const allNumeric = nonGenericHeaders.every(h => !isNaN(Number(h)) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(h));
    if (allNumeric && nonGenericHeaders.length > 0) {
      score -= 10;
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
      // Common generic headers
      /^(id|name|title|description|type|status|date|time|amount|price|quantity|total)$/i,
      /^(item|product|service|category|group|department|location|contact|email|phone)$/i,
      /^(address|city|state|country|zip|code|number|reference|comment|note|notes)$/i,
      
      // Construction/Project headers
      /^(project|job|task|phase|trade|contractor|subcontractor|vendor|bid)$/i,
      /^(scope|work|material|labor|equipment|cost|budget|actual|variance)$/i,
      /^(schedule|start|end|duration|completion|milestone|deliverable)$/i,
      /^(rfi|submittal|change.?order|co|drawing|spec|revision)$/i,
      
      // Finance/Accounting headers
      /^(account|invoice|payment|balance|credit|debit|tax|discount)$/i,
      /^(revenue|expense|profit|margin|rate|fee|charge)$/i,
      /^(po|purchase.?order|requisition|approval|authorized)$/i,
      
      // HR/Employee headers
      /^(employee|staff|worker|manager|supervisor|department|division)$/i,
      /^(hours|overtime|pto|vacation|sick|rate|salary|wage)$/i,
      
      // Inventory/Supply headers
      /^(sku|part|component|stock|inventory|qty|unit|uom)$/i,
      /^(warehouse|bin|shelf|supplier|manufacturer|brand)$/i,
      
      // Contains key words
      /\b(id|name|date|time|status|type|code|no|num|qty|amt)\b/i,
      /\b(total|subtotal|sum|count|avg|min|max)\b/i,
    ];
    
    return headerPatterns.some(pattern => pattern.test(text));
  }

  public async getSpreadsheetInfo(
    encryptedTokens: EncryptedTokens,
    spreadsheetId: string
  ): Promise<{ title: string } | null> {
    try {
      const sheetsClient = await this.createSheetsClient(encryptedTokens);
      
      const response = await sheetsClient.spreadsheets.get({
        spreadsheetId,
        fields: 'properties(title)'
      });

      return {
        title: response.data.properties?.title || 'Unknown Spreadsheet'
      };
    } catch (error: any) {
      console.log(`⚠️ Could not get spreadsheet title: ${error.message}`);
      return null;
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

  private extractEmbeddedImage(cellData: any): { url: string; id: string } | null {
    // Check if this cell has any embedded image information
    // The Google Sheets API might provide image references in different ways
    
    // Check for hyperlinks that might contain Drive image references
    if (cellData.hyperlink) {
      const hyperlink = cellData.hyperlink;
      const drivePattern = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/;
      const match = hyperlink.match(drivePattern);
      if (match && match[1]) {
        return {
          url: `https://drive.google.com/uc?export=download&id=${match[1]}`,
          id: match[1]
        };
      }
    }

    // Check effectiveValue for any image references
    if (cellData.effectiveValue) {
      const effectiveValue = cellData.effectiveValue;
      
      // Check if effectiveValue contains any image-related data
      if (typeof effectiveValue === 'string') {
        const driveImageMatch = this.extractDriveImageFromValue(effectiveValue);
        if (driveImageMatch) {
          return driveImageMatch;
        }
      }
    }

    // Check formattedValue for image references
    if (cellData.formattedValue && typeof cellData.formattedValue === 'string') {
      const driveImageMatch = this.extractDriveImageFromValue(cellData.formattedValue);
      if (driveImageMatch) {
        return driveImageMatch;
      }
    }

    // Check textFormatRuns for any embedded content that might indicate images
    if (cellData.textFormatRuns && Array.isArray(cellData.textFormatRuns)) {
      for (const run of cellData.textFormatRuns) {
        if (run.format && run.format.link && run.format.link.uri) {
          const driveImageMatch = this.extractDriveImageFromValue(run.format.link.uri);
          if (driveImageMatch) {
            return driveImageMatch;
          }
        }
      }
    }

    // Unfortunately, directly embedded images (like the ones in your screenshot)
    // might not be accessible through the Sheets API in a straightforward way
    // They might be stored as drawing objects which require different API calls
    
    return null;
  }

  private extractDriveImageFromValue(value: string): { url: string; id: string } | null {
    // Check for various Google Drive URL patterns that might appear in cell values
    const drivePatterns = [
      // Standard Drive file URLs
      /https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
      // Drive sharing URLs
      /https?:\/\/drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/,
      // Direct file access URLs
      /https?:\/\/drive\.google\.com\/uc\?.*?id=([a-zA-Z0-9_-]+)/,
      // Alternative Drive URLs
      /https?:\/\/docs\.google\.com\/.*?\/d\/([a-zA-Z0-9_-]+)/,
      // Shortened Drive URLs
      /https?:\/\/drive\.google\.com\/([a-zA-Z0-9_-]+)/
    ];

    for (const pattern of drivePatterns) {
      const match = value.match(pattern);
      if (match && match[1]) {
        const driveId = match[1];
        
        // Create a download URL for the image
        return {
          url: `https://drive.google.com/uc?export=download&id=${driveId}`,
          id: driveId
        };
      }
    }

    // Also check for raw Drive file IDs (sometimes sheets contain just the ID)
    // This pattern matches standalone Google Drive IDs (33-34 characters)
    if (/^[a-zA-Z0-9_-]{33,34}$/.test(value.trim())) {
      const driveId = value.trim();
      return {
        url: `https://drive.google.com/uc?export=download&id=${driveId}`,
        id: driveId
      };
    }

    return null;
  }
}

export const googleSheetsService = new GoogleSheetsService();