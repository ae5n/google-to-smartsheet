export interface User {
  id: string;
  email: string;
  name: string;
  googleConnected: boolean;
  smartsheetConnected: boolean;
}

export interface GoogleSheet {
  spreadsheetId: string;
  title: string;
  sheets: GoogleSheetTab[];
}

export interface GoogleSheetTab {
  sheetId: number;
  title: string;
  gridProperties: {
    rowCount: number;
    columnCount: number;
  };
}

export interface SmartsheetSheet {
  id: number;
  name: string;
  columns: SmartsheetColumn[];
  permalink: string;
}

export interface SmartsheetColumn {
  id: number;
  title: string;
  type: string;
  primary?: boolean;
  index: number;
}

export interface ColumnMapping {
  googleColumn: string;
  smartsheetColumnId: number;
  dataType: 'text' | 'number' | 'date' | 'image' | 'hyperlink';
}

export interface TransferJob {
  id: string;
  userId: string;
  googleSpreadsheetId: string;
  googleSheetTabs: string[];
  smartsheetId: number;
  columnMappings: ColumnMapping[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: {
    totalRows: number;
    processedRows: number;
    totalImages: number;
    processedImages: number;
    progressPercentage?: number;
    imageProgressPercentage?: number;
    errors: TransferError[];
  };
  dryRun: boolean;
  createdAt: string;
  completedAt?: string;
}

export interface TransferError {
  type: 'image_access_denied' | 'image_upload_failed' | 'row_insert_failed' | 'general_error';
  message: string;
  row?: number;
  column?: string;
  details?: any;
}

export interface DryRunResult {
  totalRows: number;
  totalImages: number;
  inaccessibleImages: number;
  estimatedTime: number;
  warnings: string[];
  columnMappings: ColumnMapping[];
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  details?: any;
}