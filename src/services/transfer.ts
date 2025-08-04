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
  DryRunResult,
  EncryptedTokens
} from '../types';

export class TransferService {
  public async createTransferJob(
    userId: string,
    googleSpreadsheetId: string,
    googleSheetTabs: string[],
    smartsheetId: number,
    columnMappings: ColumnMapping[],
    dryRun: boolean = false
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
        errors: []
      },
      dryRun
    };

    return await database.createTransferJob(job);
  }

  public async executeTransfer(jobId: string): Promise<void> {
    const job = await database.getTransferJobById(jobId);
    if (!job) {
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
    // Get Google Sheets data
    const googleData = await googleSheetsService.getSpreadsheetData(
      googleTokens,
      job.googleSpreadsheetId,
      job.googleSheetTabs,
      true
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
        }))
    };

    await database.updateTransferJobStatus(job.id, 'running', progress);
  }

  private async performActualTransfer(
    job: TransferJob,
    googleTokens: EncryptedTokens,
    smartsheetTokens: EncryptedTokens
  ): Promise<void> {
    // Get Google Sheets data
    const googleData = await googleSheetsService.getSpreadsheetData(
      googleTokens,
      job.googleSpreadsheetId,
      job.googleSheetTabs,
      true
    );

    const errors: TransferError[] = [];
    let totalRows = 0;
    let processedRows = 0;
    let totalImages = 0;
    let processedImages = 0;

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

    await database.updateTransferJobStatus(job.id, 'running', {
      totalRows,
      processedRows,
      totalImages,
      processedImages,
      errors
    });

    // Process each tab
    for (const [tabName, tabData] of Object.entries(googleData)) {
      if (tabData.length <= 1) continue; // Skip if no data rows

      const dataRows = tabData.slice(1); // Skip header row

      // Process rows in batches
      const batchSize = 50;
      for (let i = 0; i < dataRows.length; i += batchSize) {
        const batch = dataRows.slice(i, i + batchSize);
        const smartsheetRows: Array<{ cells: SmartsheetCellValue[] }> = [];

        for (const googleRow of batch) {
          try {
            const smartsheetCells = await this.convertRowToSmartsheet(
              googleRow,
              job.columnMappings,
              googleTokens,
              smartsheetTokens
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
            errors.push(...result.errors.map(e => ({
              type: 'row_insert_failed' as const,
              message: e.error,
              row: e.row,
              details: e
            })));
          } catch (error: any) {
            errors.push({
              type: 'row_insert_failed',
              message: error.message,
              details: error
            });
          }
        }

        // Update progress
        await database.updateTransferJobStatus(job.id, 'running', {
          totalRows,
          processedRows,
          totalImages,
          processedImages,
          errors
        });
      }
    }
  }

  private async convertRowToSmartsheet(
    googleRow: GoogleCellValue[],
    columnMappings: ColumnMapping[],
    googleTokens: EncryptedTokens,
    smartsheetTokens: EncryptedTokens
  ): Promise<SmartsheetCellValue[]> {
    const smartsheetCells: SmartsheetCellValue[] = [];

    for (let i = 0; i < columnMappings.length; i++) {
      const mapping = columnMappings[i];
      const googleCell = googleRow[i];

      if (!googleCell) {
        smartsheetCells.push({
          columnId: mapping.smartsheetColumnId,
          value: ''
        });
        continue;
      }

      try {
        if (googleCell.isImage && googleCell.imageUrl) {
          // Handle image cell
          const imageCell = await this.processImageCell(
            googleCell,
            mapping.smartsheetColumnId,
            googleTokens,
            smartsheetTokens
          );
          smartsheetCells.push(imageCell);
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
    } catch (error) {
      // Fallback: try to attach as file or use text
      try {
        return {
          columnId,
          value: googleCell.imageUrl || '',
          hyperlink: {
            url: googleCell.imageUrl || '',
            text: 'Image Link'
          }
        };
      } catch {
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