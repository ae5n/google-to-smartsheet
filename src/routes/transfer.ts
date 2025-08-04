import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { transferService } from '../services/transfer';
import database from '../database';
import { requireAuth } from '../middleware/security';
import { APIResponse } from '../types';

const router = Router();

router.use(requireAuth);

router.post('/jobs', [
  body('googleSpreadsheetId').notEmpty().withMessage('Google spreadsheet ID is required'),
  body('googleSheetTabs').isArray({ min: 1 }).withMessage('At least one sheet tab is required'),
  body('smartsheetId').isInt({ min: 1 }).withMessage('Valid Smartsheet ID is required'),
  body('columnMappings').isArray({ min: 1 }).withMessage('Column mappings are required'),
  body('columnMappings.*.googleColumn').notEmpty().withMessage('Google column name is required'),
  body('columnMappings.*.smartsheetColumnId').isInt().withMessage('Smartsheet column ID must be an integer'),
  body('columnMappings.*.dataType').isIn(['text', 'number', 'date', 'image', 'hyperlink']).withMessage('Invalid data type'),
  body('dryRun').optional().isBoolean().withMessage('Dry run must be a boolean')
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
    const {
      googleSpreadsheetId,
      googleSheetTabs,
      smartsheetId,
      columnMappings,
      dryRun = false
    } = req.body;

    const userId = req.session.user!.id;

    // Verify user has both Google and Smartsheet connections
    const user = await database.getUserById(userId);
    if (!user?.googleTokens) {
      return res.status(400).json({
        success: false,
        error: 'Google account not connected'
      } as APIResponse);
    }

    if (!user?.smartsheetTokens) {
      return res.status(400).json({
        success: false,
        error: 'Smartsheet account not connected'
      } as APIResponse);
    }

    // Create transfer job
    const job = await transferService.createTransferJob(
      userId,
      googleSpreadsheetId,
      googleSheetTabs,
      smartsheetId,
      columnMappings,
      dryRun
    );

    // Start transfer in background
    transferService.executeTransfer(job.id).catch(error => {
      console.error(`Transfer job ${job.id} failed:`, error);
    });

    res.json({
      success: true,
      data: { jobId: job.id, status: job.status }
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const userId = req.session.user!.id;

    const job = await database.getTransferJobById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Transfer job not found'
      } as APIResponse);
    }

    // Verify job belongs to user
    if (job.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      } as APIResponse);
    }

    res.json({
      success: true,
      data: job
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/jobs/:jobId/progress', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const userId = req.session.user!.id;

    const job = await transferService.getTransferProgress(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Transfer job not found'
      } as APIResponse);
    }

    // Verify job belongs to user
    if (job.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      } as APIResponse);
    }

    const progressPercentage = job.progress.totalRows > 0 
      ? Math.round((job.progress.processedRows / job.progress.totalRows) * 100)
      : 0;

    const imageProgressPercentage = job.progress.totalImages > 0
      ? Math.round((job.progress.processedImages / job.progress.totalImages) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        progress: {
          ...job.progress,
          progressPercentage,
          imageProgressPercentage
        },
        createdAt: job.createdAt,
        completedAt: job.completedAt
      }
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/jobs/:jobId/dry-run-result', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const userId = req.session.user!.id;

    const job = await database.getTransferJobById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Transfer job not found'
      } as APIResponse);
    }

    // Verify job belongs to user
    if (job.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      } as APIResponse);
    }

    if (!job.dryRun) {
      return res.status(400).json({
        success: false,
        error: 'Job is not a dry run'
      } as APIResponse);
    }

    const result = await transferService.getDryRunResult(jobId);
    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Dry run result not found'
      } as APIResponse);
    }

    res.json({
      success: true,
      data: result
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.post('/jobs/:jobId/cancel', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const userId = req.session.user!.id;

    const job = await database.getTransferJobById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Transfer job not found'
      } as APIResponse);
    }

    // Verify job belongs to user
    if (job.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      } as APIResponse);
    }

    await transferService.cancelTransfer(jobId);

    res.json({
      success: true,
      message: 'Transfer job cancelled'
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const userId = req.session.user!.id;
    const limit = parseInt(req.query.limit as string) || 20;

    const jobs = await database.getUserTransferJobs(userId, Math.min(limit, 100));

    res.json({
      success: true,
      data: jobs
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

router.get('/jobs/:jobId/errors', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const userId = req.session.user!.id;

    const job = await database.getTransferJobById(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Transfer job not found'
      } as APIResponse);
    }

    // Verify job belongs to user
    if (job.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      } as APIResponse);
    }

    // Format errors for download
    const errorReport = {
      jobId: job.id,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      status: job.status,
      summary: {
        totalErrors: job.progress.errors.length,
        errorTypes: job.progress.errors.reduce((acc: any, error) => {
          acc[error.type] = (acc[error.type] || 0) + 1;
          return acc;
        }, {})
      },
      errors: job.progress.errors.map((error, index) => ({
        id: index + 1,
        type: error.type,
        message: error.message,
        row: error.row,
        column: error.column,
        timestamp: new Date().toISOString()
      }))
    };

    res.json({
      success: true,
      data: errorReport
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message
    } as APIResponse);
  }
});

export default router;