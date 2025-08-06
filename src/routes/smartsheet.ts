import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { smartsheetAPIService } from '../smartsheet/api';
import { smartsheetAuthService } from '../auth/smartsheet';
import database from '../database';
import { requireAuth } from '../middleware/security';
import { APIResponse } from '../types';

const router = Router();

router.use(requireAuth);

router.get('/workspaces', async (req: Request, res: Response) => {
  try {
    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const workspaces = await smartsheetAPIService.getUserWorkspaces(validTokens);

    res.json({
      success: true,
      data: workspaces
    } as APIResponse);
  } catch (error: any) {
    if (error.message.includes('Token expired')) {
      res.status(401).json({
        success: false,
        error: 'Smartsheet authentication expired. Please reconnect your account.'
      } as APIResponse);
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      } as APIResponse);
    }
  }
});

router.get('/workspaces/:workspaceId/folders', async (req: Request, res: Response) => {
  try {
    const workspaceId = parseInt(req.params.workspaceId);
    
    if (isNaN(workspaceId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid workspace ID'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const folders = await smartsheetAPIService.getWorkspaceFolders(validTokens, workspaceId);

    res.json({
      success: true,
      data: folders
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/folders/:folderId/sheets', async (req: Request, res: Response) => {
  try {
    const folderId = parseInt(req.params.folderId);
    
    if (isNaN(folderId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid folder ID'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const sheets = await smartsheetAPIService.getFolderSheets(validTokens, folderId);

    res.json({
      success: true,
      data: sheets
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.post('/workspaces/:workspaceId/folders', [
  body('name').notEmpty().isLength({ min: 1, max: 100 }).withMessage('Folder name is required and must be 1-100 characters')
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    } as APIResponse);
  }

  try {
    const workspaceId = parseInt(req.params.workspaceId);
    const { name } = req.body;
    
    if (isNaN(workspaceId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid workspace ID'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const folder = await smartsheetAPIService.createFolderInWorkspace(validTokens, workspaceId, name);

    res.json({
      success: true,
      data: folder
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/sheets', async (req: Request, res: Response) => {
  try {
    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const sheets = await smartsheetAPIService.getUserSheets(validTokens);

    res.json({
      success: true,
      data: sheets
    } as APIResponse);
  } catch (error: any) {
    if (error.message.includes('Token expired')) {
      res.status(401).json({
        success: false,
        error: 'Smartsheet authentication expired. Please reconnect your account.'
      } as APIResponse);
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      } as APIResponse);
    }
  }
});

router.get('/sheets/:sheetId', async (req: Request, res: Response) => {
  try {
    const sheetId = parseInt(req.params.sheetId);
    
    if (isNaN(sheetId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sheet ID'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const sheet = await smartsheetAPIService.getSheetDetails(validTokens, sheetId);

    res.json({
      success: true,
      data: sheet
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.post('/sheets', [
  body('name').notEmpty().isLength({ min: 1, max: 100 }).withMessage('Sheet name is required and must be 1-100 characters'),
  body('columns').isArray({ min: 1 }).withMessage('At least one column is required'),
  body('columns.*.title').notEmpty().withMessage('Column title is required'),
  body('columns.*.type').optional().isIn(['TEXT_NUMBER', 'DATE', 'DATETIME', 'CONTACT_LIST', 'CHECKBOX', 'PICKLIST', 'DURATION']).withMessage('Invalid column type'),
  body('workspaceId').optional().isNumeric().withMessage('Workspace ID must be numeric'),
  body('folderId').optional().isNumeric().withMessage('Folder ID must be numeric')
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    } as APIResponse);
  }

  try {
    const { name, columns, workspaceId, folderId } = req.body;
    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const sheet = await smartsheetAPIService.createSheet(
      validTokens, 
      name, 
      columns,
      workspaceId ? parseInt(workspaceId) : undefined,
      folderId ? parseInt(folderId) : undefined
    );

    res.json({
      success: true,
      data: sheet
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.post('/sheets/:sheetId/columns', [
  body('columns').isArray({ min: 1 }).withMessage('At least one column is required'),
  body('columns.*.title').notEmpty().withMessage('Column title is required'),
  body('columns.*.type').optional().isIn(['TEXT_NUMBER', 'DATE', 'DATETIME', 'CONTACT_LIST', 'CHECKBOX', 'PICKLIST', 'DURATION']).withMessage('Invalid column type')
], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    } as APIResponse);
  }

  try {
    const sheetId = parseInt(req.params.sheetId);
    const { columns } = req.body;
    
    if (isNaN(sheetId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sheet ID'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const newColumns = await smartsheetAPIService.addColumnsToSheet(
      validTokens,
      sheetId,
      columns
    );

    res.json({
      success: true,
      data: newColumns
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/validate-access/:sheetId', async (req: Request, res: Response) => {
  try {
    const sheetId = parseInt(req.params.sheetId);
    
    if (isNaN(sheetId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sheet ID'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const hasAccess = await smartsheetAPIService.validateSheetAccess(validTokens, sheetId);

    res.json({
      success: true,
      data: { hasAccess }
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/sheets/:sheetId/row-count', async (req: Request, res: Response) => {
  try {
    const sheetId = parseInt(req.params.sheetId);
    
    if (isNaN(sheetId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sheet ID'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    const rowCount = await smartsheetAPIService.getSheetRowCount(validTokens, sheetId);

    res.json({
      success: true,
      data: { rowCount }
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.delete('/sheets/:sheetId', async (req: Request, res: Response) => {
  try {
    const sheetId = parseInt(req.params.sheetId);
    
    if (isNaN(sheetId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sheet ID'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    const validTokens = await smartsheetAuthService.validateAndRefreshTokens(
      user.id,
      user.smartsheetTokens
    );

    await smartsheetAPIService.deleteSheet(validTokens, sheetId);

    res.json({
      success: true,
      message: 'Sheet deleted successfully'
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

export default router;