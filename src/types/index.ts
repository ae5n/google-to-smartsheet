export interface User {
  id: string;
  email: string;
  name: string;
  googleTokens?: EncryptedTokens;
  smartsheetTokens?: EncryptedTokens;
  createdAt: Date;
  updatedAt: Date;
}

export interface EncryptedTokens {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  encryptedData: string;
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
  googleColumnIndex?: number;
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
  headerRowIndex?: number;
  selectedColumns?: number[];
  createdAt: Date;
  completedAt?: Date;
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
  timestamp: Date;
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

export interface ImageCache {
  hash: string;
  smartsheetImageId: string;
  url: string;
  createdAt: Date;
}

export interface OAuthState {
  state: string;
  codeVerifier: string;
  userId?: string;
  provider: 'google' | 'smartsheet';
  createdAt: Date;
}

export interface GoogleCellValue {
  value: any;
  formula?: string;
  hyperlink?: string;
  isImage: boolean;
  imageUrl?: string;
  imageId?: string;
}

export interface SmartsheetCellValue {
  columnId: number;
  value?: any;
  objectValue?: {
    objectType: 'IMAGE';
    imageId: string;
  };
  hyperlink?: {
    url: string;
    text?: string;
  };
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
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  googleConnected: boolean;
  smartsheetConnected: boolean;
}