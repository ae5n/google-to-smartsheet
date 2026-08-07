import axios, { AxiosResponse } from 'axios';
import { 
  APIResponse, 
  User, 
  GoogleSheet, 
  SmartsheetSheet, 
  TransferJob,
  DryRunResult
} from '../types';

const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? window.location.origin 
  : '';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 60000,
});

/**
 * The CSRF token is per-session and stable, so it is fetched once and cached.
 * Fetching it before every mutating call doubled our request count against the
 * server's rate limiter. In-flight fetches are shared so a burst of parallel
 * writes triggers exactly one token request.
 */
let csrfToken: string | null = null;
let csrfInFlight: Promise<string | null> | null = null;

const getCsrfToken = async (force = false): Promise<string | null> => {
  if (csrfToken && !force) return csrfToken;
  if (csrfInFlight) return csrfInFlight;

  csrfInFlight = axios
    .get('/api/csrf-token', { withCredentials: true })
    .then(response => {
      csrfToken = response.data.csrfToken ?? null;
      return csrfToken;
    })
    .catch(error => {
      console.warn('Failed to get CSRF token:', error);
      return null;
    })
    .finally(() => {
      csrfInFlight = null;
    });

  return csrfInFlight;
};

api.interceptors.request.use(async (config) => {
  if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase() || '')) {
    if (!config.headers['Content-Type']) {
      config.headers['Content-Type'] = 'application/json';
    }

    const token = await getCsrfToken();
    if (token) {
      config.headers['X-CSRF-Token'] = token;
    }
  }
  return config;
});

api.interceptors.response.use(
  response => response,
  async (error) => {
    const original = error.config;

    // A rotated session invalidates the cached token — refresh once and retry.
    if (
      error.response?.status === 403 &&
      error.response?.data?.code === 'CSRF_INVALID' &&
      original &&
      !original.__csrfRetried
    ) {
      original.__csrfRetried = true;
      const token = await getCsrfToken(true);
      if (token) {
        original.headers['X-CSRF-Token'] = token;
        return api.request(original);
      }
    }

    // Surface the server's backoff hint so callers can wait it out.
    if (error.response?.status === 429) {
      const retryAfter = Number(error.response.headers?.['retry-after']);
      error.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 30_000;
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  getUser: (): Promise<AxiosResponse<APIResponse<User | null>>> =>
    api.get('/auth/user'),

  initiateGoogleAuth: (): Promise<AxiosResponse<APIResponse<{ authUrl: string }>>> =>
    api.get('/auth/google'),

  initiateSmartsheetAuth: (): Promise<AxiosResponse<APIResponse<{ authUrl: string }>>> =>
    api.get('/auth/smartsheet'),

  disconnectGoogle: (): Promise<AxiosResponse<APIResponse>> =>
    api.post('/auth/google/disconnect'),

  disconnectSmartsheet: (): Promise<AxiosResponse<APIResponse>> =>
    api.post('/auth/smartsheet/disconnect', {}),

  logout: (): Promise<AxiosResponse<APIResponse>> =>
    api.post('/auth/logout', {}),
};

// Google API
export const googleAPI = {
  getSpreadsheets: (): Promise<AxiosResponse<APIResponse<GoogleSheet[]>>> =>
    api.get('/api/google/spreadsheets'),

  getSpreadsheetTabs: (spreadsheetId: string): Promise<AxiosResponse<APIResponse<any[]>>> =>
    api.get(`/api/google/spreadsheets/${spreadsheetId}/tabs`),

  getSpreadsheetHeaders: (spreadsheetId: string, sheetTab: string): Promise<AxiosResponse<APIResponse<string[]>>> =>
    api.get(`/api/google/spreadsheets/${spreadsheetId}/headers`, {
      params: { sheetTab }
    }),

  getHeaderPreview: (spreadsheetId: string, sheetTab: string): Promise<AxiosResponse<APIResponse<{
    rows: string[][];
    detectedHeaderRow: number;
    detectedHeaders: string[];
    rowOptions: Array<{ rowIndex: number; preview: string[]; score: number }>;
  }>>> =>
    api.get(`/api/google/spreadsheets/${spreadsheetId}/header-preview`, {
      params: { sheetTab }
    }),

  previewSpreadsheet: (spreadsheetId: string, sheetTabs: string[]): Promise<AxiosResponse<APIResponse<any>>> =>
    api.post(`/api/google/spreadsheets/${spreadsheetId}/preview`, { sheetTabs }),

  validateAccess: (spreadsheetId: string): Promise<AxiosResponse<APIResponse<{ hasAccess: boolean }>>> =>
    api.get(`/api/google/validate-access/${spreadsheetId}`),
};

// Smartsheet API
export const smartsheetAPI = {
  getWorkspaces: (): Promise<AxiosResponse<APIResponse<any[]>>> =>
    api.get('/api/smartsheet/workspaces'),

  getWorkspaceFolders: (workspaceId: number): Promise<AxiosResponse<APIResponse<any[]>>> =>
    api.get(`/api/smartsheet/workspaces/${workspaceId}/folders`),

  createFolder: (workspaceId: number, name: string): Promise<AxiosResponse<APIResponse<any>>> =>
    api.post(`/api/smartsheet/workspaces/${workspaceId}/folders`, { name }),

  getSheets: (): Promise<AxiosResponse<APIResponse<SmartsheetSheet[]>>> =>
    api.get('/api/smartsheet/sheets'),

  getFolderSheets: (folderId: number): Promise<AxiosResponse<APIResponse<SmartsheetSheet[]>>> =>
    api.get(`/api/smartsheet/folders/${folderId}/sheets`),

  getSheetDetails: (sheetId: number): Promise<AxiosResponse<APIResponse<SmartsheetSheet>>> =>
    api.get(`/api/smartsheet/sheets/${sheetId}`),

  createSheet: (
    name: string, 
    columns: Array<{ title: string; type: string; primary?: boolean }>,
    workspaceId?: number,
    folderId?: number
  ): Promise<AxiosResponse<APIResponse<SmartsheetSheet>>> =>
    api.post('/api/smartsheet/sheets', { name, columns, workspaceId, folderId }),

  addColumns: (sheetId: number, columns: Array<{ title: string; type: string }>): Promise<AxiosResponse<APIResponse<any[]>>> =>
    api.post(`/api/smartsheet/sheets/${sheetId}/columns`, { columns }),

  validateAccess: (sheetId: number): Promise<AxiosResponse<APIResponse<{ hasAccess: boolean }>>> =>
    api.get(`/api/smartsheet/validate-access/${sheetId}`),

  getRowCount: (sheetId: number): Promise<AxiosResponse<APIResponse<{ rowCount: number }>>> =>
    api.get(`/api/smartsheet/sheets/${sheetId}/row-count`),

  deleteSheet: (sheetId: number): Promise<AxiosResponse<APIResponse>> =>
    api.delete(`/api/smartsheet/sheets/${sheetId}`),
};

// Transfer API
export const transferAPI = {
  createJob: (jobData: {
    googleSpreadsheetId: string;
    googleSheetTabs: string[];
    smartsheetId: number;
    columnMappings: any[];
    dryRun?: boolean;
    headerRowIndex?: number;
    selectedColumns?: number[];
  }): Promise<AxiosResponse<APIResponse<{ jobId: string; status: string }>>> =>
    api.post('/api/transfer/jobs', jobData),

  getJob: (jobId: string): Promise<AxiosResponse<APIResponse<TransferJob>>> =>
    api.get(`/api/transfer/jobs/${jobId}`),

  getJobProgress: (jobId: string): Promise<AxiosResponse<APIResponse<any>>> =>
    api.get(`/api/transfer/jobs/${jobId}/progress`),

  getDryRunResult: (jobId: string): Promise<AxiosResponse<APIResponse<DryRunResult>>> =>
    api.get(`/api/transfer/jobs/${jobId}/dry-run-result`),

  cancelJob: (jobId: string): Promise<AxiosResponse<APIResponse>> =>
    api.post(`/api/transfer/jobs/${jobId}/cancel`),

  getUserJobs: (limit?: number): Promise<AxiosResponse<APIResponse<TransferJob[]>>> =>
    api.get('/api/transfer/jobs', { params: { limit } }),

  getJobErrors: (jobId: string): Promise<AxiosResponse<APIResponse<any>>> =>
    api.get(`/api/transfer/jobs/${jobId}/errors`),
};

export default api;
