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
  googleColumnIndex?: number;
}

export type TransferStatus =
  | 'pending'
  | 'running'
  | 'completed'
  /** Finished, but some rows or images did not make it. */
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export interface TransferJob {
  id: string;
  userId: string;
  googleSpreadsheetId: string;
  googleSheetTabs: string[];
  smartsheetId: number;
  columnMappings: ColumnMapping[];
  status: TransferStatus;
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
  /** Rows read and attempted. */
  processedRows: number;
  /** Rows Smartsheet confirmed. This is the number that means "transferred". */
  insertedRows?: number;
  failedRows?: number;
  totalImages: number;
  /** Images with a decided outcome — not merely queued. */
  processedImages: number;
  successfulImages?: number;
  fallbackImages?: number;
  failedImages?: number;
  currentBatch?: number;
  totalBatches?: number;
  currentTab?: string;
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
  /** Server-assigned sequence number; used to resume without refetching. */
  seq?: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  emoji: string;
  details?: any;
}

export type RowResultStatus = 'inserted' | 'failed' | 'skipped';
export type ImageResultStatus = 'embedded' | 'link_fallback' | 'failed' | 'skipped';

export interface RowResultRecord {
  tabName: string;
  sourceRowNumber: number;
  targetRowId?: number;
  targetRowNumber?: number;
  status: RowResultStatus;
  error?: string;
}

export interface ImageResultRecord {
  tabName: string;
  sourceRowNumber: number;
  sourceColumn?: string;
  targetRowId?: number;
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

export interface LedgerResponse {
  kind: 'rows' | 'images';
  entries: Array<RowResultRecord | ImageResultRecord>;
  summary: LedgerSummary;
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
  /** 1-based source sheet row number. */
  row?: number;
  tab?: string;
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
