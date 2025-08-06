import { v4 as uuidv4 } from 'uuid';
import { googleSheetsService } from '../google/sheets';
import { googleDriveService } from '../google/drive';
import { smartsheetAPIService } from '../smartsheet/api';
import { googleAuthService } from '../auth/google';
import { smartsheetAuthService } from '../auth/smartsheet';
import database from '../database';
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
  EncryptedTokens
} from '../types';

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
    
    // Log concisely - only essential details, avoid verbose output
    if (details && typeof details === 'object') {
      // Only log specific useful details
      const summary: string[] = [];
      if ('progress' in details && details.progress) summary.push(`progress: ${details.progress}`);
      if ('success' in details && details.success !== undefined) summary.push(`success: ${details.success}`);
      if ('failed' in details && details.failed !== undefined) summary.push(`failed: ${details.failed}`);
      if ('batch' in details && details.batch !== undefined) summary.push(`batch: ${details.batch}`);
      if ('totalRows' in details && details.totalRows !== undefined) summary.push(`rows: ${details.totalRows}`);
      if ('totalImages' in details && details.totalImages !== undefined) summary.push(`images: ${details.totalImages}`);
      if ('error' in details && details.error) summary.push(`error: ${details.error}`);
      if ('tab' in details && details.tab) summary.push(`tab: ${details.tab}`);
      
      const summaryText = summary.length > 0 ? ` (${summary.join(', ')})` : '';
      console.log(`${emoji} ${message}${summaryText}`);
    } else {
      console.log(`${emoji} ${message}${details ? ` - ${details}` : ''}`);
    }
    
    const job = await database.getTransferJobById(jobId);
    if (job) {
      const updatedLogs = [...(job.logs || []), log];
      await database.updateTransferJobLogs(jobId, updatedLogs);
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
        totalImages: 0,
        processedImages: 0,
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
        await this.performDryRun(job, googleTokens, smartsheetTokens);
      } else {
        await this.performActualTransfer(job, googleTokens, smartsheetTokens);
      }

      await this.addJobLog(jobId, 'success', 'Transfer completed successfully', '✅');
      await database.updateTransferJobStatus(jobId, 'completed');
    } catch (error: any) {
      const currentJob = await database.getTransferJobById(jobId);
      if (currentJob) {
        const updatedProgress = {
          ...currentJob.progress,
          errors: [
            ...currentJob.progress.errors,
            {
              type: 'general_error' as const,
              message: error.message,
              details: error
            }
          ]
        };
        await this.addJobLog(jobId, 'error', `Transfer failed: ${error.message}`, '❌');
        await database.updateTransferJobStatus(jobId, 'failed', updatedProgress);
      }
      throw error;
    }
  }

  private async performDryRun(
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

    // Count rows and images
    for (const [tabName, tabData] of Object.entries(googleData)) {
      if (tabData.length > 1) { // Exclude header row
        totalRows += tabData.length - 1;
      }

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

    // Validate image access (sample)
    const imageValidationSample = images.slice(0, Math.min(50, images.length));
    const imageValidationResults = await googleDriveService.batchValidateImages(
      googleTokens,
      imageValidationSample
    );

    const inaccessibleCount = imageValidationResults.filter(r => !r.accessible).length;
    const estimatedInaccessibleImages = images.length > 50
      ? Math.round((inaccessibleCount / imageValidationSample.length) * images.length)
      : inaccessibleCount;

    // Update job progress
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

    // Add source and target info to job
    await this.addJobLog(job.id, 'info', 'Transfer started', '🚀', {
      headerRow: headerRowIndex + 1,
      targetSheetId: job.smartsheetId
    });

    // Get Google Sheets data and source info
    const googleData = await googleSheetsService.getSpreadsheetData(
      googleTokens,
      job.googleSpreadsheetId,
      job.googleSheetTabs,
      true,
      headerRowIndex
    );

    // Get actual spreadsheet name
    const spreadsheetInfo = await googleSheetsService.getSpreadsheetInfo(googleTokens, job.googleSpreadsheetId);
    const sourceInfo: SourceInfo = {
      spreadsheetTitle: spreadsheetInfo?.title || `Spreadsheet ${job.googleSpreadsheetId}`,
      tabNames: job.googleSheetTabs,
      headerRowIndex: headerRowIndex + 1,
      totalDataRows: 0,
      totalImages: 0
    };

    // Fix column mappings and get target info
    const actualSheet = await smartsheetAPIService.getSheetDetails(smartsheetTokens, job.smartsheetId);
    const targetInfo: TargetInfo = {
      sheetName: actualSheet.name,
      sheetUrl: actualSheet.permalink
    };
    
    const fixedColumnMappings = job.columnMappings.map((mapping, index) => {
      const actualColumn = actualSheet.columns[index];
      if (actualColumn) {
        return {
          ...mapping,
          smartsheetColumnId: actualColumn.id
        };
      } else {
        console.error(`❌ Column mapping failed: Trying to map to column ${index + 1} but existing sheet "${actualSheet.name}" only has ${actualSheet.columns.length} columns`);
        throw new Error(`Cannot map ${job.columnMappings.length} columns to existing sheet "${actualSheet.name}" which only has ${actualSheet.columns.length} columns. Please select fewer columns or use a different target sheet.`);
      }
    });

    // Use the fixed mappings for the rest of the transfer
    job.columnMappings = fixedColumnMappings;

    const errors: TransferError[] = [];
    let totalRows = 0;
    let processedRows = 0;
    let totalImages = 0;
    let processedImages = 0;
    let successfulImages = 0;
    let fallbackImages = 0;
    let failedImages = 0;

    // Count total rows and images first
    for (const [tabName, tabData] of Object.entries(googleData)) {
      if (tabData.length > 1) {
        totalRows += tabData.length - 1; // Exclude header
      }
      for (const row of tabData) {
        for (const cell of row) {
          if (cell.isImage) totalImages++;
        }
      }
    }

    // Update source info with actual counts
    sourceInfo.totalDataRows = totalRows;
    sourceInfo.totalImages = totalImages;
    
    // Save source and target info to job
    await database.updateTransferJobInfo(job.id, sourceInfo, targetInfo);
    
    await this.addJobLog(job.id, 'info', 'Transfer initialized', '📋', {
      source: sourceInfo.spreadsheetTitle,
      target: targetInfo.sheetName,
      totalRows,
      totalImages
    });

    await database.updateTransferJobStatus(job.id, 'running', {
      totalRows,
      processedRows,
      totalImages,
      processedImages,
      successfulImages,
      fallbackImages,
      failedImages,
      errors,
      warnings: []
    });

    // Process each tab
    for (const [tabName, tabData] of Object.entries(googleData)) {
      if (tabData.length <= 1) {
        continue; // Skip if no data rows
      }

      const dataRows = tabData.slice(1); // Skip header row
      await this.addJobLog(job.id, 'info', `Processing ${tabName}`, '📋', { 
        tab: tabName, 
        rows: dataRows.length 
      });

      // Process rows in batches
      const batchSize = 50;
      for (let i = 0; i < dataRows.length; i += batchSize) {
        const batch = dataRows.slice(i, i + batchSize);
        const smartsheetRows: Array<{ cells: SmartsheetCellValue[] }> = [];
        const imageQueue: Array<{ rowIndex: number; columnId: number; imageUrl: string; imageId?: string }> = [];

        for (let rowIndex = 0; rowIndex < batch.length; rowIndex++) {
          const googleRow = batch[rowIndex];
          try {
            const smartsheetCells = await this.convertRowToSmartsheet(
              googleRow,
              job.columnMappings,
              googleTokens,
              smartsheetTokens,
              imageQueue,
              rowIndex
            );


            smartsheetRows.push({ cells: smartsheetCells });

            // Update image progress
            for (const cell of googleRow) {
              if (cell.isImage) {
                processedImages++;
              }
            }
          } catch (error: any) {
            errors.push({
              type: 'row_insert_failed',
              message: error.message,
              row: processedRows + smartsheetRows.length,
              details: error
            });
          }
        }

        // Insert batch to Smartsheet
        if (smartsheetRows.length > 0) {
          try {
            const result = await smartsheetAPIService.addRowsToSheet(
              smartsheetTokens,
              job.smartsheetId,
              smartsheetRows
            );

            processedRows += result.success;
            
            const batchNum = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(dataRows.length / batchSize);
            const progressPercent = Math.round((processedRows / totalRows) * 100);
            
            await this.addJobLog(job.id, 'success', `Batch ${batchNum}/${totalBatches} completed`, '✅', {
              success: result.success,
              failed: result.failed,
              progress: `${processedRows}/${totalRows} (${progressPercent}%)`
            });
            
            // Process images for successfully inserted rows
            if (imageQueue.length > 0 && result.success > 0) {
              const imageResults = await this.processImageQueue(
                imageQueue, 
                result, 
                job.smartsheetId,
                googleTokens,
                smartsheetTokens
              );
              
              // Update image statistics
              successfulImages += imageResults.successful;
              fallbackImages += imageResults.fallbacks;
              failedImages += imageResults.failed;
              
              // Log image processing results
              if (imageResults.successful > 0 || imageResults.fallbacks > 0 || imageResults.failed > 0) {
                await this.addJobLog(job.id, 'info', `Image processing completed`, '🖼️', {
                  successful: imageResults.successful,
                  fallbacks: imageResults.fallbacks,
                  failed: imageResults.failed,
                  total: imageQueue.length
                });
                
                // Add warning if there were fallbacks or failures
                if (imageResults.fallbacks > 0) {
                  await this.addJobLog(job.id, 'warn', `${imageResults.fallbacks} images converted to links (download failed)`, '⚠️');
                }
                if (imageResults.failed > 0) {
                  await this.addJobLog(job.id, 'error', `${imageResults.failed} images could not be processed`, '❌');
                }
              }
            }
            
            errors.push(...result.errors.map(e => ({
              type: 'row_insert_failed' as const,
              message: e.error,
              row: e.row,
              details: e
            })));
          } catch (error: any) {
            await this.addJobLog(job.id, 'error', 'Batch insertion failed', '❌', {
              error: error.message,
              batch: Math.floor(i / batchSize) + 1
            });
            errors.push({
              type: 'row_insert_failed',
              message: error.message,
              details: error
            });
          }
        }

        // Update progress with batch info
        await database.updateTransferJobStatus(job.id, 'running', {
          totalRows,
          processedRows,
          totalImages,
          processedImages,
          successfulImages,
          fallbackImages,
          failedImages,
          currentBatch: Math.floor(i / batchSize) + 1,
          totalBatches: Math.ceil(dataRows.length / batchSize),
          errors,
          warnings: []
        });
      }
    }
  }

  private async convertRowToSmartsheet(
    googleRow: GoogleCellValue[],
    columnMappings: ColumnMapping[],
    googleTokens: EncryptedTokens,
    smartsheetTokens: EncryptedTokens,
    imageQueue?: Array<{ rowIndex: number; columnId: number; imageUrl: string; imageId?: string }>,
    currentRowIndex?: number
  ): Promise<SmartsheetCellValue[]> {
    const smartsheetCells: SmartsheetCellValue[] = [];

    for (let i = 0; i < columnMappings.length; i++) {
      const mapping = columnMappings[i];
      // Use the original Google column index if available, otherwise fall back to sequential index
      const googleColumnIndex = mapping.googleColumnIndex !== undefined ? mapping.googleColumnIndex : i;
      const googleCell = googleRow[googleColumnIndex];

      if (!googleCell) {
        smartsheetCells.push({
          columnId: mapping.smartsheetColumnId,
          value: ''
        });
        continue;
      }

      try {
        if (googleCell.isImage && googleCell.imageUrl) {
          // Create placeholder cell for image (will add actual image after row creation)
          smartsheetCells.push({
            columnId: mapping.smartsheetColumnId,
            value: 'Loading image...'
          });
          
          // Add to image queue for later processing
          if (imageQueue && currentRowIndex !== undefined) {
            imageQueue.push({
              rowIndex: currentRowIndex,
              columnId: mapping.smartsheetColumnId,
              imageUrl: googleCell.imageUrl,
              imageId: googleCell.imageId
            });
          }
        } else if (googleCell.hyperlink && mapping.dataType === 'hyperlink') {
          // Handle hyperlink cell
          smartsheetCells.push({
            columnId: mapping.smartsheetColumnId,
            value: googleCell.value || googleCell.hyperlink,
            hyperlink: {
              url: googleCell.hyperlink,
              text: googleCell.value || googleCell.hyperlink
            }
          });
        } else {
          // Handle regular cell
          smartsheetCells.push({
            columnId: mapping.smartsheetColumnId,
            value: this.formatCellValue(googleCell.value, mapping.dataType)
          });
        }
      } catch (error) {
        // Fallback to text value if processing fails
        smartsheetCells.push({
          columnId: mapping.smartsheetColumnId,
          value: googleCell.value || ''
        });
      }
    }

    return smartsheetCells;
  }

  private async processImageCell(
    googleCell: GoogleCellValue,
    columnId: number,
    googleTokens: EncryptedTokens,
    smartsheetTokens: EncryptedTokens
  ): Promise<SmartsheetCellValue> {
    try {
      if (!googleCell.imageUrl) {
        throw new Error('No image URL found');
      }

      // Download image
      const imageData = await googleDriveService.downloadImage(
        googleTokens,
        googleCell.imageUrl,
        googleCell.imageId
      );

      // Upload to Smartsheet
      const imageId = await smartsheetAPIService.uploadImage(
        smartsheetTokens,
        imageData.buffer,
        imageData.filename,
        imageData.mimeType
      );

      return {
        columnId,
        objectValue: {
          objectType: 'IMAGE',
          imageId
        }
      };
    } catch (error: any) {
      // Fallback: use URL as hyperlink when image processing fails  
      if (googleCell.imageUrl) {
        return {
          columnId,
          value: 'Image Link',
          hyperlink: {
            url: googleCell.imageUrl,
            text: 'Image Link'
          }
        };
      } else {
        return {
          columnId,
          value: googleCell.value || 'Image not accessible'
        };
      }
    }
  }

  private formatCellValue(value: any, dataType: string): any {
    if (value === null || value === undefined) {
      return '';
    }

    switch (dataType) {
      case 'number':
        const num = parseFloat(value);
        return isNaN(num) ? value : num;
      case 'date':
        // Try to parse as date
        const date = new Date(value);
        return isNaN(date.getTime()) ? value : date.toISOString().split('T')[0];
      default:
        return String(value);
    }
  }

  private async processImageQueue(
    imageQueue: Array<{ rowIndex: number; columnId: number; imageUrl: string; imageId?: string }>,
    insertResult: any,
    sheetId: number,
    googleTokens: EncryptedTokens,
    smartsheetTokens: EncryptedTokens
  ): Promise<{ successful: number; failed: number; fallbacks: number }> {
    // Get the actual row IDs from the insert result - try different possible structures
    const insertedRows = insertResult.result || insertResult.data || insertResult || [];
    
    let successful = 0;
    let failed = 0;
    let fallbacks = 0;
    
    // Log image processing concisely
    if (imageQueue.length > 0) {
      console.log(`🖼️ Processing ${imageQueue.length} images`);
    }
    
    for (const imageItem of imageQueue) {
      // Find the corresponding inserted row first (outside try block)
      const insertedRow = insertedRows[imageItem.rowIndex];
      if (!insertedRow || !insertedRow.id) {
        failed++;
        continue; // Skip - row structure issues
      }

      try {
        // Download and add image
        const imageData = await googleDriveService.downloadImage(
          googleTokens,
          imageItem.imageUrl,
          imageItem.imageId
        );
        
        await smartsheetAPIService.addImageToCell(
          smartsheetTokens,
          sheetId,
          insertedRow.id,
          imageItem.columnId,
          imageData.buffer,
          imageData.filename,
          imageData.mimeType
        );
        
        successful++;
      } catch (error: any) {
        // Fallback: update cell with URL hyperlink
        console.log(`⚠️ Image fallback: ${imageItem.imageUrl}`);
        try {
          await smartsheetAPIService.updateCellWithUrl(
            smartsheetTokens,
            sheetId,
            insertedRow.id,
            imageItem.columnId,
            imageItem.imageUrl
          );
          fallbacks++;
        } catch (fallbackError: any) {
          console.log(`❌ Image processing failed: ${fallbackError.message}`);
          failed++;
        }
      }
    }
    
    return { successful, failed, fallbacks };
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

  public async cancelTransfer(jobId: string): Promise<void> {
    const job = await database.getTransferJobById(jobId);
    if (!job) {
      throw new Error('Transfer job not found');
    }

    if (job.status === 'running') {
      await database.updateTransferJobStatus(jobId, 'cancelled');
    }
  }
}

export const transferService = new TransferService();