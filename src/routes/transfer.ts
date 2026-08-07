import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { createHash } from 'crypto';
import { transferService } from '../services/transfer';
import database from '../database';
import { requireAuth, pollingRateLimiter } from '../middleware/security';
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
  body('dryRun').optional().isBoolean().withMessage('Dry run must be a boolean'),
  body('headerRowIndex').optional().isInt({ min: 0 }).withMessage('Header row index must be a non-negative integer'),
  body('selectedColumns').optional().isArray().withMessage('Selected columns must be an array')
], async (req: Request, res: Response) => {
  console.log(`🚀 Creating transfer job for user ${req.session.user?.id}`);

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Transfer job validation errors:', errors.array());
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
      dryRun = false,
      headerRowIndex,
      selectedColumns
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
      dryRun,
      headerRowIndex,
      selectedColumns
    );

    // Start transfer in background
    transferService.executeTransfer(job.id).catch(error => {
      console.error(`❌ Transfer job ${job.id} failed:`, error);
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

/**
 * Resolves a job and asserts the caller owns it. Every job-scoped route goes
 * through this so ownership can never be forgotten on a new endpoint.
 */
async function loadOwnedJob(req: Request, res: Response) {
  const job = await database.getTransferJobById(req.params.jobId);

  if (!job) {
    res.status(404).json({ success: false, error: 'Transfer job not found' } as APIResponse);
    return null;
  }

  if (job.userId !== req.session.user!.id) {
    // Same response as "not found": do not confirm the job exists.
    res.status(404).json({ success: false, error: 'Transfer job not found' } as APIResponse);
    return null;
  }

  return job;
}

router.get('/jobs/:jobId', pollingRateLimiter, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const userId = req.session.user!.id;

    // Logs have their own incremental endpoint. Returning the full append-only
    // history here made every fallback poll download the entire log again.
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

    // Create ETag based on job state for caching
    const jobStateHash = createHash('md5')
      .update(JSON.stringify({
        status: job.status,
        processedRows: job.progress?.processedRows || 0,
        processedImages: job.progress?.processedImages || 0,
        errors: job.progress?.errors?.length || 0,
        completedAt: job.completedAt
      }))
      .digest('hex');

    const etag = `"${jobStateHash}"`;
    
    // Check if client has cached version
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === etag) {
      return res.status(304).end(); // Not modified
    }

    // Set ETag header for caching
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    
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

router.get('/jobs/:jobId/progress', pollingRateLimiter, async (req: Request, res: Response) => {
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

    // Create ETag for progress caching
    const progressHash = createHash('md5')
      .update(JSON.stringify({
        status: job.status,
        processedRows: job.progress.processedRows,
        processedImages: job.progress.processedImages,
        totalRows: job.progress.totalRows,
        totalImages: job.progress.totalImages,
        errors: job.progress.errors?.length || 0,
        warnings: job.progress.warnings?.length || 0,
        completedAt: job.completedAt,
        progressPercentage,
        imageProgressPercentage
      }))
      .digest('hex');

    const etag = `"progress-${progressHash}"`;
    
    // Check if client has cached version
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === etag) {
      return res.status(304).end(); // Not modified
    }

    // Set ETag header for caching
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');

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

/**
 * Incremental log fetch. `?afterSeq=N` returns only entries newer than N, so a
 * client that reconnects resumes rather than re-downloading the history.
 */
router.get('/jobs/:jobId/logs', pollingRateLimiter, async (req: Request, res: Response) => {
  try {
    const job = await loadOwnedJob(req, res);
    if (!job) return;

    const afterSeq = parseInt(req.query.afterSeq as string, 10) || 0;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 500, 2000);
    const logs = await database.getTransferLogs(job.id, afterSeq, limit);

    res.json({
      success: true,
      data: {
        logs,
        total: await database.countTransferLogs(job.id),
        lastSeq: logs.length > 0 ? logs[logs.length - 1].seq : afterSeq
      }
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as APIResponse);
  }
});

/**
 * The audit ledger: what actually landed. `status` filters to e.g. only the
 * rows that failed, which is the practical starting point for a re-run.
 */
router.get('/jobs/:jobId/ledger', async (req: Request, res: Response) => {
  try {
    const job = await loadOwnedJob(req, res);
    if (!job) return;

    const kind = req.query.kind === 'images' ? 'images' : 'rows';
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 200, 1000);
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const entries =
      kind === 'images'
        ? await database.getImageResults(job.id, { status, limit, offset })
        : await database.getRowResults(job.id, { status, limit, offset });

    res.json({
      success: true,
      data: { kind, entries, summary: await database.getLedgerSummary(job.id) }
    } as APIResponse);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as APIResponse);
  }
});

const csvEscape = (value: any): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV export of the full ledger — the artefact to hand someone as proof. */
router.get('/jobs/:jobId/ledger.csv', async (req: Request, res: Response) => {
  try {
    const job = await loadOwnedJob(req, res);
    if (!job) return;

    const kind = req.query.kind === 'images' ? 'images' : 'rows';
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;

    const header =
      kind === 'images'
        ? [
            'tab',
            'source_row',
            'source_column',
            'status',
            'target_row_number',
            'target_row_id',
            'target_column_id',
            'image_url',
            'error'
          ]
        : ['tab', 'source_row', 'status', 'target_row_id', 'target_row_number', 'error'];

    const lines: string[] = [header.join(',')];

    // Paged so a job with hundreds of thousands of rows does not have to be
    // materialised in memory before the first byte goes out.
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const page =
        kind === 'images'
          ? await database.getImageResults(job.id, { status, limit: pageSize, offset })
          : await database.getRowResults(job.id, { status, limit: pageSize, offset });

      if (page.length === 0) break;

      for (const entry of page) {
        const row =
          kind === 'images'
            ? [
                (entry as any).tabName,
                entry.sourceRowNumber,
                (entry as any).sourceColumn,
                entry.status,
                (entry as any).targetRowNumber,
                entry.targetRowId,
                (entry as any).targetColumnId,
                (entry as any).imageUrl,
                entry.error
              ]
            : [
                entry.tabName,
                entry.sourceRowNumber,
                entry.status,
                entry.targetRowId,
                (entry as any).targetRowNumber,
                entry.error
              ];
        lines.push(row.map(csvEscape).join(','));
      }

      if (page.length < pageSize) break;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="transfer-${job.id}-${kind}.csv"`
    );
    res.send(lines.join('\r\n'));
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message } as APIResponse);
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
