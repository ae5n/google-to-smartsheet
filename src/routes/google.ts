import { Router, Request, Response } from 'express';
import { googleSheetsService } from '../google/sheets';
import { googleDriveService } from '../google/drive';
import { googleAuthService } from '../auth/google';
import database from '../database';
import { requireAuth } from '../middleware/security';
import { APIResponse } from '../types';

const router = Router();

router.use(requireAuth);

router.get('/spreadsheets', async (req: Request, res: Response) => {
  try {
    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.googleTokens) {
      return res.status(400).json({
        success: false,
        error: 'Google account not connected'
      } as APIResponse);
    }

    // Validate and refresh tokens if needed
    const validTokens = await googleAuthService.validateAndRefreshTokens(
      user.id,
      user.googleTokens
    );

    const spreadsheets = await googleSheetsService.getUserSpreadsheets(validTokens);

    res.json({
      success: true,
      data: spreadsheets
    } as APIResponse);
  } catch (error: any) {
    if (error.message.includes('authentication expired')) {
      res.status(401).json({
        success: false,
        error: 'Google authentication expired. Please reconnect your account.'
      } as APIResponse);
    } else {
      res.status(500).json({
        success: false,
        error: error.message
      } as APIResponse);
    }
  }
});

router.get('/spreadsheets/:spreadsheetId/tabs', async (req: Request, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.googleTokens) {
      return res.status(400).json({
        success: false,
        error: 'Google account not connected'
      } as APIResponse);
    }

    const validTokens = await googleAuthService.validateAndRefreshTokens(
      user.id,
      user.googleTokens
    );

    const tabs = await googleSheetsService.getSpreadsheetTabs(validTokens, spreadsheetId);

    res.json({
      success: true,
      data: tabs
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/spreadsheets/:spreadsheetId/headers', async (req: Request, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const { sheetTab } = req.query;
    
    if (!sheetTab || typeof sheetTab !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Sheet tab name is required'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.googleTokens) {
      return res.status(400).json({
        success: false,
        error: 'Google account not connected'
      } as APIResponse);
    }

    const validTokens = await googleAuthService.validateAndRefreshTokens(
      user.id,
      user.googleTokens
    );

    const headers = await googleSheetsService.getSpreadsheetHeaders(
      validTokens,
      spreadsheetId,
      sheetTab
    );

    res.json({
      success: true,
      data: headers
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/spreadsheets/:spreadsheetId/header-preview', async (req: Request, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const { sheetTab } = req.query;
    
    if (!sheetTab || typeof sheetTab !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Sheet tab name is required'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.googleTokens) {
      return res.status(400).json({
        success: false,
        error: 'Google account not connected'
      } as APIResponse);
    }

    const validTokens = await googleAuthService.validateAndRefreshTokens(
      user.id,
      user.googleTokens
    );

    const previewData = await googleSheetsService.getHeaderPreview(
      validTokens,
      spreadsheetId,
      sheetTab
    );

    res.json({
      success: true,
      data: previewData
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.post('/spreadsheets/:spreadsheetId/preview', async (req: Request, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const { sheetTabs } = req.body;
    
    if (!Array.isArray(sheetTabs) || sheetTabs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Sheet tabs array is required'
      } as APIResponse);
    }

    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.googleTokens) {
      return res.status(400).json({
        success: false,
        error: 'Google account not connected'
      } as APIResponse);
    }

    const validTokens = await googleAuthService.validateAndRefreshTokens(
      user.id,
      user.googleTokens
    );

    // Get sample data (first 10 rows) for preview
    const data = await googleSheetsService.getSpreadsheetData(
      validTokens,
      spreadsheetId,
      sheetTabs,
      true
    );

    // Count total rows and images
    let totalRows = 0;
    let totalImages = 0;
    const images: Array<{ url: string; driveFileId?: string }> = [];

    for (const [tabName, tabData] of Object.entries(data)) {
      totalRows += Math.max(0, tabData.length - 1); // Exclude header row
      
      for (const row of tabData) {
        for (const cell of row) {
          if (cell.isImage && cell.imageUrl) {
            totalImages++;
            images.push({
              url: cell.imageUrl,
              driveFileId: cell.imageId
            });
          }
        }
      }
    }

    // Validate image access (sample of first 20 images)
    const imageValidationSample = images.slice(0, 20);
    const imageValidationResults = await googleDriveService.batchValidateImages(
      validTokens,
      imageValidationSample
    );

    const inaccessibleImages = imageValidationResults.filter(result => !result.accessible).length;
    const estimatedInaccessibleImages = images.length > 20 
      ? Math.round((inaccessibleImages / imageValidationSample.length) * images.length)
      : inaccessibleImages;

    res.json({
      success: true,
      data: {
        preview: data,
        summary: {
          totalRows,
          totalImages,
          inaccessibleImages: estimatedInaccessibleImages,
          estimatedTime: Math.ceil((totalRows + totalImages) / 100) // Rough estimate: 100 items per minute
        }
      }
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/validate-access/:spreadsheetId', async (req: Request, res: Response) => {
  try {
    const { spreadsheetId } = req.params;
    const user = await database.getUserById(req.session.user!.id);
    
    if (!user?.googleTokens) {
      return res.status(400).json({
        success: false,
        error: 'Google account not connected'
      } as APIResponse);
    }

    const validTokens = await googleAuthService.validateAndRefreshTokens(
      user.id,
      user.googleTokens
    );

    const hasAccess = await googleSheetsService.validateSpreadsheetAccess(
      validTokens,
      spreadsheetId
    );

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

export default router;