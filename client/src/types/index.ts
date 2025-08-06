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

export interface SmartsheetWorkspace {
  id: number;
  name: string;
  permalink: string;
}

export interface SmartsheetFolder {
  id: number;
  name: string;
  permalink: string;
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
  progress: TransferProgress;
  dryRun: boolean;
  createdAt: string;
  completedAt?: string;
  // Enhanced job metadata
  sourceInfo?: SourceInfo;
  targetInfo?: TargetInfo;
  logs?: TransferLog[];
}

export interface TransferProgress {
  totalRows: number;
  processedRows: number;
  totalImages: number;
  processedImages: number;
  currentBatch?: number;
  totalBatches?: number;
  errors: TransferError[];
  warnings: TransferWarning[];
  progressPercentage?: number;
  imageProgressPercentage?: number;
}

export interface SourceInfo {
  spreadsheetTitle: string;
  tabNames: string[];
  headerRowIndex: number;
  totalDataRows: number;
  totalImages: number;
}

export interface TargetInfo {
  sheetName: string;
  workspaceName?: string;
  folderName?: string;
  sheetUrl?: string;
}

export interface TransferLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  emoji: string;
  details?: any;
}

export interface TransferWarning {
  type: 'image_fallback' | 'data_truncation' | 'type_conversion';
  message: string;
  count?: number;
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