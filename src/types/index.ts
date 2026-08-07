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
  /**
   * `completed_with_errors` exists because the old code reported a plain
   * `completed` even when hundreds of rows had failed — the single most
   * misleading thing the UI could say.
   */
  status: 'pending' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';
  progress: TransferProgress;
  cancelRequested?: boolean;
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
  /** Rows read from the source and attempted. */
  processedRows: number;
  /** Rows Smartsheet confirmed with a target row id. The number to trust. */
  insertedRows?: number;
  failedRows?: number;
  totalImages: number;
  /** Images whose outcome is decided — not merely queued. */
  processedImages: number;
  successfulImages?: number;
  fallbackImages?: number;
  failedImages?: number;
  currentBatch?: number;
  totalBatches?: number;
  currentTab?: string;
  errors: TransferError[];
  warnings: TransferWarning[];
}

export type RowResultStatus = 'inserted' | 'failed' | 'skipped';

export interface RowResultRecord {
  tabName: string;
  /** 1-based row number in the source Google Sheet, as the user sees it. */
  sourceRowNumber: number;
  targetRowId?: number;
  targetRowNumber?: number;
  status: RowResultStatus;
  error?: string;
}

export type ImageResultStatus = 'embedded' | 'link_fallback' | 'failed' | 'skipped';

export interface ImageResultRecord {
  tabName: string;
  sourceRowNumber: number;
  sourceColumn?: string;
  targetRowId?: number;
  /** 1-based row number in the destination Smartsheet sheet. */
  targetRowNumber?: number;
  targetColumnId?: number;
  imageUrl?: string;
  status: ImageResultStatus;
  error?: string;
}

export interface LedgerSummary {
  rows: Record<string, number>;
  images: Record<string, number>;
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
  /** Monotonic sequence number; lets clients resume from what they've seen. */
  seq?: number;
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
  type:
    | 'image_access_denied'
    | 'image_upload_failed'
    | 'row_insert_failed'
    | 'row_convert_failed'
    | 'rate_limited'
    | 'general_error';
  message: string;
  /** 1-based source sheet row number — not an index into a batch. */
  row?: number;
  tab?: string;
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
