import { v4 as uuidv4 } from 'uuid';
import { googleSheetsService } from '../google/sheets';
import { googleDriveService } from '../google/drive';
import { smartsheetAPIService } from '../smartsheet/api';
import { googleAuthService } from '../auth/google';
import { smartsheetAuthService } from '../auth/smartsheet';
import database from '../database';
import { webSocketService } from './websocket';
import { imageGate } from '../utils/rateLimiter';
import {
  TransferJob,
  ColumnMapping,
  GoogleCellValue,
  SmartsheetCellValue,
  TransferError,
  TransferWarning,
  TransferLog,
  SourceInfo,
  TargetInfo,
  DryRunResult,
  EncryptedTokens,
  RowResultRecord,
  ImageResultRecord
} from '../types';

/** Raised when the user cancels; unwinds the transfer without marking failure. */
class TransferCancelled extends Error {
  constructor() {
    super('Transfer cancelled by user');
    this.name = 'TransferCancelled';
  }
}

/** One image awaiting upload, tied to the batch row it came from. */
interface QueuedImage {
  /** Index into the batch's row array — the join key to the insert results. */
  batchIndex: number;
  sourceRowNumber: number;
  columnId: number;
  sourceColumn: string;
  imageUrl: string;
  imageId?: string;
}

const ROW_BATCH_SIZE = 50;

export class TransferService {
  private async addJobLog(
    jobId: string,
    level: 'info' | 'warn' | 'error' | 'success',
    message: string,
    emoji: string,
    details?: any
  ): Promise<void> {
    const log: TransferLog = {
      timestamp: new Date(),
      level,
      message,
      emoji,
      details
    };

    // Append-only: no read-modify-write of a growing JSON blob, so entries
    // cannot be lost and cost stays constant as the log grows.
    const stored = await database.appendTransferLog(jobId, log);

    const detailText =
      details && typeof details === 'object'
        ? ` ${JSON.stringify(details)}`
        : details
          ? ` - ${details}`
          : '';
    console.log(`${emoji} ${message}${detailText}`);

    webSocketService.emitJobLog(jobId, stored);
  }

  private async checkCancelled(jobId: string): Promise<void> {
    if (await database.isCancelRequested(jobId)) {
      throw new TransferCancelled();
    }
  }

  public async createTransferJob(
    userId: string,
    googleSpreadsheetId: string,
    googleSheetTabs: string[],
    smartsheetId: number,
    columnMappings: ColumnMapping[],
    dryRun: boolean = false,
    headerRowIndex?: number,
    selectedColumns?: number[]
  ): Promise<TransferJob> {
    const job: Omit<TransferJob, 'createdAt' | 'completedAt'> = {
      id: uuidv4(),
      userId,
      googleSpreadsheetId,
      googleSheetTabs,
      smartsheetId,
      columnMappings,
      status: 'pending',
      progress: {
        totalRows: 0,
        processedRows: 0,
        insertedRows: 0,
        failedRows: 0,
        totalImages: 0,
        processedImages: 0,
        successfulImages: 0,
        fallbackImages: 0,
        failedImages: 0,
        errors: [],
        warnings: []
      },
      logs: [],
      dryRun,
      headerRowIndex,
      selectedColumns
    };

    return await database.createTransferJob(job);
  }

  public async executeTransfer(jobId: string): Promise<void> {
    const job = await database.getTransferJobById(jobId);
    if (!job) {
      console.error(`❌ Transfer job ${jobId} not found`);
      throw new Error('Transfer job not found');
    }

    if (job.status !== 'pending') {
      throw new Error('Transfer job is not in pending status');
    }

    const user = await database.getUserById(job.userId);
    if (!user?.googleTokens || !user?.smartsheetTokens) {
      await database.updateTransferJobStatus(jobId, 'failed');
      throw new Error('User authentication tokens not found');
    }

    try {
      await database.updateTransferJobStatus(jobId, 'running');

      // Validate and refresh tokens
      const googleTokens = await googleAuthService.validateAndRefreshTokens(
        user.id,
        user.googleTokens
      );
      const smartsheetTokens = await smartsheetAuthService.validateAndRefreshTokens(
        user.id,
        user.smartsheetTokens
      );

      if (job.dryRun) {
        await this.performDryRun(job, googleTokens);
        await this.addJobLog(jobId, 'success', 'Dry run completed', '✅');
        await database.updateTransferJobStatus(jobId, 'completed');
      } else {
        await this.performActualTransfer(job, googleTokens, smartsheetTokens);
        await this.finalise(jobId);
      }

      const completedJob = await database.getTransferJobById(jobId);
      if (completedJob) {
        webSocketService.emitJobCompleted(jobId, completedJob);
      }
    } catch (error: any) {
      if (error instanceof TransferCancelled) {
        await this.addJobLog(jobId, 'warn', 'Transfer cancelled', '⏹️');
        await database.updateTransferJobStatus(jobId, 'cancelled');
        const cancelledJob = await database.getTransferJobById(jobId);
        if (cancelledJob) {
          webSocketService.emitJobCompleted(jobId, cancelledJob);
        }
        return;
      }

      const currentJob = await database.getTransferJobById(jobId);
      if (currentJob) {
        const updatedProgress = {
          ...currentJob.progress,
          errors: [
            ...currentJob.progress.errors,
            {
              type: 'general_error' as const,
              message: error.message,
              details: {
                name: error.name,
                message: error.message,
                stack: error.stack
              }
            }
          ]
        };
        await this.addJobLog(jobId, 'error', `Transfer failed: ${error.message}`, '❌');
        await database.updateTransferJobStatus(jobId, 'failed', updatedProgress);

        const failedJob = await database.getTransferJobById(jobId);
        if (failedJob) {
          webSocketService.emitJobFailed(jobId, failedJob, error.message);
        }
      }
      throw error;
    }
  }

  /**
   * Chooses the terminal status from the ledger rather than from whether the
   * loop happened to finish. A run that inserted 400 of 500 rows is not a
   * success, and must not be reported as one.
   */
  private async finalise(jobId: string): Promise<void> {
    const summary = await database.getLedgerSummary(jobId);
    const inserted = summary.rows.inserted || 0;
    const failed = summary.rows.failed || 0;
    const skipped = summary.rows.skipped || 0;
    const imagesFailed = summary.images.failed || 0;
    const imagesFallback = summary.images.link_fallback || 0;

    const hasProblems = failed > 0 || skipped > 0 || imagesFailed > 0;

    if (hasProblems) {
      await this.addJobLog(
        jobId,
        'warn',
        `Transfer finished with issues — ${inserted} rows transferred, ${failed + skipped} not transferred`,
        '⚠️',
        {
          rowsInserted: inserted,
          rowsFailed: failed,
          rowsSkipped: skipped,
          imagesEmbedded: summary.images.embedded || 0,
          imagesAsLinks: imagesFallback,
          imagesFailed
        }
      );
      await database.updateTransferJobStatus(jobId, 'completed_with_errors');
    } else {
      await this.addJobLog(
        jobId,
        'success',
        `Transfer completed — all ${inserted} rows transferred`,
        '✅',
        {
          rowsInserted: inserted,
          imagesEmbedded: summary.images.embedded || 0,
          imagesAsLinks: imagesFallback
        }
      );
      await database.updateTransferJobStatus(jobId, 'completed');
    }
  }

  private async performDryRun(
    job: TransferJob,
    googleTokens: EncryptedTokens
  ): Promise<void> {
    // Use user-selected header row index or detect it automatically
    let headerRowIndex = job.headerRowIndex;
    if (headerRowIndex === undefined) {
      const firstTab = job.googleSheetTabs[0];
      const result = await googleSheetsService.getSpreadsheetHeadersWithRowIndex(
        googleTokens,
        job.googleSpreadsheetId,
        firstTab
      );
      headerRowIndex = result.headerRowIndex;
    }

    // Get Google Sheets data starting from the correct header row
    const googleData = await googleSheetsService.getSpreadsheetData(
      googleTokens,
      job.googleSpreadsheetId,
      job.googleSheetTabs,
      true,
      headerRowIndex
    );

    let totalRows = 0;
    let totalImages = 0;
    const images: Array<{ url: string; driveFileId?: string }> = [];

    for (const [, tabData] of Object.entries(googleData)) {
      if (tabData.length > 1) {
        totalRows += tabData.length - 1;
      }

      // Skip the header row: it is not data, and counting it inflated the
      // image total the user was shown.
      for (const row of tabData.slice(1)) {
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

    // Validate image access (sample)
    const imageValidationSample = images.slice(0, Math.min(50, images.length));
    const imageValidationResults = await googleDriveService.batchValidateImages(
      googleTokens,
      imageValidationSample
    );

    const progress = {
      totalRows,
      processedRows: totalRows, // Mark as "processed" for dry run
      totalImages,
      processedImages: totalImages,
      errors: imageValidationResults
        .filter(r => !r.accessible)
        .map(r => ({
          type: 'image_access_denied' as const,
          message: `Image not accessible: ${r.error}`,
          details: { url: r.url }
        })),
      warnings: []
    };

    await database.updateTransferJobStatus(job.id, 'running', progress);
  }

  private async performActualTransfer(
    job: TransferJob,
    googleTokens: EncryptedTokens,
    smartsheetTokens: EncryptedTokens
  ): Promise<void> {
    // Use user-selected header row index or detect it automatically
    let headerRowIndex = job.headerRowIndex;
    if (headerRowIndex === undefined) {
      const firstTab = job.googleSheetTabs[0];
      const result = await googleSheetsService.getSpreadsheetHeadersWithRowIndex(
        googleTokens,
        job.googleSpreadsheetId,
        firstTab
      );
      headerRowIndex = result.headerRowIndex;
    }

    await this.addJobLog(job.id, 'info', 'Transfer started', '🚀', {
      headerRow: headerRowIndex + 1,
      targetSheetId: job.smartsheetId
    });

    const googleData = await googleSheetsService.getSpreadsheetData(
      googleTokens,
      job.googleSpreadsheetId,
      job.googleSheetTabs,
      true,
      headerRowIndex
    );

    const spreadsheetInfo = await googleSheetsService.getSpreadsheetInfo(
      googleTokens,
      job.googleSpreadsheetId
    );
    const sourceInfo: SourceInfo = {
      spreadsheetTitle: spreadsheetInfo?.title || `Spreadsheet ${job.googleSpreadsheetId}`,
      tabNames: job.googleSheetTabs,
      headerRowIndex: headerRowIndex + 1,
      totalDataRows: 0,
      totalImages: 0
    };

    const actualSheet = await smartsheetAPIService.getSheetDetails(
      smartsheetTokens,
      job.smartsheetId
    );
    const targetInfo: TargetInfo = {
      sheetName: actualSheet.name,
      sheetUrl: actualSheet.permalink
    };

    const fixedColumnMappings = job.columnMappings.map((mapping, index) => {
      const actualColumn = actualSheet.columns[index];
      if (!actualColumn) {
        throw new Error(
          `Cannot map ${job.columnMappings.length} columns to existing sheet "${actualSheet.name}" which only has ${actualSheet.columns.length} columns. Please select fewer columns or use a different target sheet.`
        );
      }
      return { ...mapping, smartsheetColumnId: actualColumn.id };
    });

    job.columnMappings = fixedColumnMappings;

    /** Resolves a mapping to its source column index, once, up front. */
    const sourceIndexOf = (mapping: ColumnMapping, position: number): number =>
      mapping.googleColumnIndex !== undefined ? mapping.googleColumnIndex : position;

    const errors: TransferError[] = [];
    const warnings: TransferWarning[] = [];
    let totalRows = 0;
    let totalImages = 0;

    // Count rows and images from the mapped columns of data rows only.
    for (const [, tabData] of Object.entries(googleData)) {
      if (tabData.length > 1) {
        totalRows += tabData.length - 1;
      }
      for (const row of tabData.slice(1)) {
        job.columnMappings.forEach((mapping, position) => {
          const cell = row[sourceIndexOf(mapping, position)];
          if (cell?.isImage && cell.imageUrl) totalImages++;
        });
      }
    }

    sourceInfo.totalDataRows = totalRows;
    sourceInfo.totalImages = totalImages;

    await database.updateTransferJobInfo(job.id, sourceInfo, targetInfo);

    await this.addJobLog(job.id, 'info', 'Transfer initialized', '📋', {
      source: sourceInfo.spreadsheetTitle,
      target: targetInfo.sheetName,
      totalRows,
      totalImages
    });

    // Running tallies. Every one of these is derived from a confirmed outcome,
    // never from an intention.
    let processedRows = 0;
    let insertedRows = 0;
    let failedRows = 0;
    let processedImages = 0;
    let successfulImages = 0;
    let fallbackImages = 0;
    let failedImages = 0;

    const publishProgress = async (extra: Record<string, any> = {}) => {
      await database.updateTransferJobStatus(job.id, 'running', {
        totalRows,
        processedRows,
        insertedRows,
        failedRows,
        totalImages,
        processedImages,
        successfulImages,
        fallbackImages,
        failedImages,
        errors,
        warnings,
        ...extra
      });

      const updated = await database.getTransferJobById(job.id);
      if (updated) webSocketService.emitJobUpdate(job.id, updated);
    };

    await publishProgress();

    for (const [tabName, tabData] of Object.entries(googleData)) {
      if (tabData.length <= 1) {
        continue; // No data rows
      }

      const dataRows = tabData.slice(1);
      // Source row numbers as the user sees them in Google Sheets: the header
      // is at `headerRowIndex` (0-based), so the first data row is +2 in
      // 1-based terms. Error messages now reference real, findable rows.
      const firstDataRowNumber = headerRowIndex + 2;

      await this.addJobLog(job.id, 'info', `Processing ${tabName}`, '📋', {
        tab: tabName,
        rows: dataRows.length
      });

      const totalBatches = Math.ceil(dataRows.length / ROW_BATCH_SIZE);

      for (let offset = 0; offset < dataRows.length; offset += ROW_BATCH_SIZE) {
        await this.checkCancelled(job.id);

        const batch = dataRows.slice(offset, offset + ROW_BATCH_SIZE);
        const batchNum = Math.floor(offset / ROW_BATCH_SIZE) + 1;

        const smartsheetRows: Array<{ cells: SmartsheetCellValue[] }> = [];
        const imageQueue: QueuedImage[] = [];
        const rowLedger: RowResultRecord[] = [];
        const imageLedger: ImageResultRecord[] = [];

        /**
         * Maps position-in-`smartsheetRows` back to the source row number.
         * This is the fix for the image misalignment bug: previously the image
         * queue keyed on the index within `batch`, while insert results are
         * aligned to `smartsheetRows`. Any row that failed conversion was
         * skipped, shifting every subsequent index by one — and images silently
         * attached to the wrong rows.
         */
        const batchIndexToSourceRow: number[] = [];

        for (let i = 0; i < batch.length; i++) {
          const googleRow = batch[i];
          const sourceRowNumber = firstDataRowNumber + offset + i;
          processedRows++;

          try {
            const pendingImages: QueuedImage[] = [];
            const cells = this.convertRowToSmartsheet(
              googleRow,
              job.columnMappings,
              sourceIndexOf,
              sourceRowNumber,
              pendingImages
            );

            const batchIndex = smartsheetRows.length;
            smartsheetRows.push({ cells });
            batchIndexToSourceRow[batchIndex] = sourceRowNumber;

            for (const image of pendingImages) {
              imageQueue.push({ ...image, batchIndex });
            }
          } catch (error: any) {
            // The row never reached Smartsheet — record it as such.
            failedRows++;
            rowLedger.push({
              tabName,
              sourceRowNumber,
              status: 'failed',
              error: `Could not build row: ${error.message}`
            });
            errors.push({
              type: 'row_convert_failed',
              message: error.message,
              row: sourceRowNumber,
              tab: tabName
            });
          }
        }

        if (smartsheetRows.length > 0) {
          let outcome;
          try {
            outcome = await smartsheetAPIService.addRowsToSheet(
              smartsheetTokens,
              job.smartsheetId,
              smartsheetRows
            );
          } catch (error: any) {
            // addRowsToSheet resolves per-row rather than throwing, so reaching
            // here means something outside the insert itself broke.
            failedRows += smartsheetRows.length;
            smartsheetRows.forEach((_, index) => {
              rowLedger.push({
                tabName,
                sourceRowNumber: batchIndexToSourceRow[index],
                status: 'failed',
                error: error.message
              });
            });
            errors.push({
              type: 'row_insert_failed',
              message: error.message,
              tab: tabName,
              details: { batch: batchNum }
            });

            await database.recordRowResults(job.id, rowLedger);
            await this.addJobLog(job.id, 'error', `Batch ${batchNum}/${totalBatches} failed`, '❌', {
              tab: tabName,
              error: error.message
            });
            await publishProgress({ currentBatch: batchNum, totalBatches, currentTab: tabName });
            continue;
          }

          insertedRows += outcome.success;
          failedRows += outcome.failed;

          for (const result of outcome.results) {
            const sourceRowNumber = batchIndexToSourceRow[result.index];
            rowLedger.push({
              tabName,
              sourceRowNumber,
              targetRowId: result.rowId,
              targetRowNumber: result.rowNumber,
              status: result.inserted ? 'inserted' : 'failed',
              error: result.error
            });

            if (!result.inserted) {
              errors.push({
                type: 'row_insert_failed',
                message: result.error || 'Row insert failed',
                row: sourceRowNumber,
                tab: tabName
              });
            }
          }

          await database.recordRowResults(job.id, rowLedger);

          await this.addJobLog(
            job.id,
            outcome.failed > 0 ? 'warn' : 'success',
            `Batch ${batchNum}/${totalBatches} — ${outcome.success} rows transferred${
              outcome.failed > 0 ? `, ${outcome.failed} failed` : ''
            }`,
            outcome.failed > 0 ? '⚠️' : '✅',
            {
              tab: tabName,
              inserted: outcome.success,
              failed: outcome.failed,
              progress: `${insertedRows}/${totalRows}`
            }
          );

          if (imageQueue.length > 0) {
            const imageOutcome = await this.processImageQueue(
              imageQueue,
              outcome.results,
              batchIndexToSourceRow,
              tabName,
              job.smartsheetId,
              googleTokens,
              smartsheetTokens,
              imageLedger
            );

            successfulImages += imageOutcome.embedded;
            fallbackImages += imageOutcome.fallbacks;
            failedImages += imageOutcome.failed;
            processedImages += imageOutcome.embedded + imageOutcome.fallbacks + imageOutcome.failed;

            await database.recordImageResults(job.id, imageLedger);

            if (imageOutcome.fallbacks > 0) {
              warnings.push({
                type: 'image_fallback',
                message: `${imageOutcome.fallbacks} image(s) stored as links because the image itself could not be transferred`,
                count: imageOutcome.fallbacks
              });
            }

            await this.addJobLog(
              job.id,
              imageOutcome.failed > 0 ? 'warn' : 'info',
              `Images for batch ${batchNum}: ${imageOutcome.embedded} embedded, ${imageOutcome.fallbacks} as links, ${imageOutcome.failed} failed`,
              '🖼️',
              {
                tab: tabName,
                embedded: imageOutcome.embedded,
                links: imageOutcome.fallbacks,
                failed: imageOutcome.failed
              }
            );
          }
        }

        await publishProgress({ currentBatch: batchNum, totalBatches, currentTab: tabName });
      }
    }
  }

  /**
   * Builds the Smartsheet cells for one source row.
   *
   * Synchronous and side-effect free: it appends any images it finds to
   * `pendingImages` rather than uploading them, so the caller controls when
   * uploads happen and can tie each one to a confirmed target row.
   */
  private convertRowToSmartsheet(
    googleRow: GoogleCellValue[],
    columnMappings: ColumnMapping[],
    sourceIndexOf: (mapping: ColumnMapping, position: number) => number,
    sourceRowNumber: number,
    pendingImages: Array<Omit<QueuedImage, 'batchIndex'>>
  ): SmartsheetCellValue[] {
    const cells: SmartsheetCellValue[] = [];

    columnMappings.forEach((mapping, position) => {
      const googleCell = googleRow[sourceIndexOf(mapping, position)];

      if (!googleCell) {
        cells.push({ columnId: mapping.smartsheetColumnId, value: '' });
        return;
      }

      if (googleCell.isImage && googleCell.imageUrl) {
        // Placeholder is a link to the source, not the bare text
        // "Loading image..." — if every later attempt fails, the cell still
        // points somewhere useful instead of lying about being in progress.
        cells.push({
          columnId: mapping.smartsheetColumnId,
          value: 'Image (pending)',
          hyperlink: { url: googleCell.imageUrl, text: 'Image (pending)' }
        });

        pendingImages.push({
          sourceRowNumber,
          columnId: mapping.smartsheetColumnId,
          sourceColumn: mapping.googleColumn,
          imageUrl: googleCell.imageUrl,
          imageId: googleCell.imageId
        });
        return;
      }

      if (googleCell.hyperlink && mapping.dataType === 'hyperlink') {
        cells.push({
          columnId: mapping.smartsheetColumnId,
          value: googleCell.value || googleCell.hyperlink,
          hyperlink: {
            url: googleCell.hyperlink,
            text: googleCell.value || googleCell.hyperlink
          }
        });
        return;
      }

      cells.push({
        columnId: mapping.smartsheetColumnId,
        value: this.formatCellValue(googleCell.value, mapping.dataType)
      });
    });

    return cells;
  }

  private formatCellValue(value: any, dataType: string): any {
    if (value === null || value === undefined) {
      return '';
    }

    switch (dataType) {
      case 'number': {
        const num = parseFloat(value);
        return isNaN(num) ? value : num;
      }
      case 'date': {
        const date = new Date(value);
        return isNaN(date.getTime()) ? value : date.toISOString().split('T')[0];
      }
      default:
        return String(value);
    }
  }

  /**
   * Downloads each queued image and attaches it to the target row that its
   * source row actually became. Images whose row failed to insert are recorded
   * as skipped rather than silently dropped.
   *
   * Runs through a concurrency gate so a 50-row batch cannot fire 50
   * simultaneous downloads and uploads at the rate limiters.
   */
  private async processImageQueue(
    imageQueue: QueuedImage[],
    insertResults: Array<{ index: number; inserted?: boolean; rowId?: number }>,
    batchIndexToSourceRow: number[],
    tabName: string,
    sheetId: number,
    googleTokens: EncryptedTokens,
    smartsheetTokens: EncryptedTokens,
    ledger: ImageResultRecord[]
  ): Promise<{ embedded: number; fallbacks: number; failed: number }> {
    const rowIdByIndex = new Map<number, number | undefined>(
      insertResults.map(r => [r.index, r.inserted ? r.rowId : undefined])
    );

    let embedded = 0;
    let fallbacks = 0;
    let failed = 0;

    await Promise.all(
      imageQueue.map(item =>
        imageGate.run(async () => {
          const targetRowId = rowIdByIndex.get(item.batchIndex);

          if (!targetRowId) {
            failed++;
            ledger.push({
              tabName,
              sourceRowNumber: item.sourceRowNumber,
              sourceColumn: item.sourceColumn,
              targetColumnId: item.columnId,
              imageUrl: item.imageUrl,
              status: 'skipped',
              error: 'Target row was not inserted, so the image had nowhere to go'
            });
            return;
          }

          try {
            const imageData = await googleDriveService.downloadImage(
              googleTokens,
              item.imageUrl,
              item.imageId
            );

            await smartsheetAPIService.addImageToCell(
              smartsheetTokens,
              sheetId,
              targetRowId,
              item.columnId,
              imageData.buffer,
              imageData.filename,
              imageData.mimeType
            );

            embedded++;
            ledger.push({
              tabName,
              sourceRowNumber: item.sourceRowNumber,
              sourceColumn: item.sourceColumn,
              targetRowId,
              targetColumnId: item.columnId,
              imageUrl: item.imageUrl,
              status: 'embedded'
            });
          } catch (error: any) {
            // The cell already holds a link to the source image from the
            // insert, so a failure here degrades gracefully — but it is still
            // recorded as a fallback, never as a success.
            try {
              await smartsheetAPIService.updateCellWithUrl(
                smartsheetTokens,
                sheetId,
                targetRowId,
                item.columnId,
                item.imageUrl
              );
              fallbacks++;
              ledger.push({
                tabName,
                sourceRowNumber: item.sourceRowNumber,
                sourceColumn: item.sourceColumn,
                targetRowId,
                targetColumnId: item.columnId,
                imageUrl: item.imageUrl,
                status: 'link_fallback',
                error: error.message
              });
            } catch (fallbackError: any) {
              failed++;
              ledger.push({
                tabName,
                sourceRowNumber: item.sourceRowNumber,
                sourceColumn: item.sourceColumn,
                targetRowId,
                targetColumnId: item.columnId,
                imageUrl: item.imageUrl,
                status: 'failed',
                error: `${error.message}; link fallback also failed: ${fallbackError.message}`
              });
            }
          }
        })
      )
    );

    return { embedded, fallbacks, failed };
  }

  public async getDryRunResult(jobId: string): Promise<DryRunResult | null> {
    const job = await database.getTransferJobById(jobId);
    if (!job || !job.dryRun) {
      return null;
    }

    return {
      totalRows: job.progress.totalRows,
      totalImages: job.progress.totalImages,
      inaccessibleImages: job.progress.errors.filter(e => e.type === 'image_access_denied').length,
      estimatedTime: Math.ceil((job.progress.totalRows + job.progress.totalImages) / 100),
      warnings: job.progress.errors.map(e => e.message),
      columnMappings: job.columnMappings
    };
  }

  public async getTransferProgress(jobId: string): Promise<TransferJob | null> {
    return await database.getTransferJobById(jobId);
  }

  /**
   * Requests cancellation. The running loop checks this between batches and
   * unwinds cleanly — previously this only flipped the status while the
   * transfer carried on writing rows.
   */
  public async cancelTransfer(jobId: string): Promise<void> {
    const job = await database.getTransferJobById(jobId);
    if (!job) {
      throw new Error('Transfer job not found');
    }

    if (job.status !== 'running' && job.status !== 'pending') {
      return; // Already finished; nothing to stop.
    }

    await database.requestCancel(jobId);
    await this.addJobLog(jobId, 'warn', 'Cancellation requested — stopping after the current batch', '⏹️');
  }
}

export const transferService = new TransferService();
