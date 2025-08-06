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

// Add CSRF token and ensure proper headers for requests
api.interceptors.request.use(async (config) => {
  if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase() || '')) {
    // Ensure Content-Type is set for POST requests
    if (!config.headers['Content-Type']) {
      config.headers['Content-Type'] = 'application/json';
    }
    
    try {
      const response = await axios.get('/api/csrf-token', {
        withCredentials: true
      });
      config.headers['X-CSRF-Token'] = response.data.csrfToken;
    } catch (error) {
      console.warn('Failed to get CSRF token:', error);
    }
  }
  return config;
});

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
    api.post('/auth/logout'),
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