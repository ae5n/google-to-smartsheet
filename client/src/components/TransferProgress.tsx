import React, { useState, useEffect } from 'react';
import { TransferJob } from '../types';

interface TransferProgressProps {
  jobId: string;
}

function TransferProgress({ jobId }: TransferProgressProps) {
  const [job, setJob] = useState<TransferJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showActivityLog, setShowActivityLog] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    const fetchProgress = async () => {
      try {
        console.log('Fetching progress for job:', jobId);
        const response = await fetch(`/api/transfer/jobs/${jobId}`);
        console.log('Response status:', response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Response error:', errorText);
          throw new Error(`Failed to fetch transfer progress: ${response.status}`);
        }
        
        const responseData = await response.json();
        console.log('Response data:', responseData);
        
        // Handle API response format { success: true, data: job }
        const jobData = responseData.success ? responseData.data : responseData;
        console.log('Processed job data:', jobData);
        setJob(jobData);
        
        // Stop polling if job is completed, failed, or cancelled
        if (jobData && ['completed', 'failed', 'cancelled'].includes(jobData.status)) {
          console.log('Job finished, stopping polling');
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
        }
      } catch (err: any) {
        console.error('Fetch error:', err);
        setError(err.message);
        // Stop polling on error
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      } finally {
        setLoading(false);
      }
    };

    fetchProgress();
    
    // Poll for updates every 2 seconds
    interval = setInterval(fetchProgress, 2000);
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [jobId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading transfer details...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex items-center">
          <span className="text-2xl mr-3">❌</span>
          <div>
            <h3 className="text-lg font-semibold text-red-800">Error Loading Transfer</h3>
            <p className="text-red-600">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <div className="flex items-center">
          <span className="text-2xl mr-3">⚠️</span>
          <div>
            <h3 className="text-lg font-semibold text-yellow-800">Transfer Not Found</h3>
            <p className="text-yellow-600">The transfer job could not be found.</p>
          </div>
        </div>
      </div>
    );
  }

  const getStatusEmoji = (status: string) => {
    const statusMap: { [key: string]: string } = {
      pending: '⏳',
      running: '🔄',
      completed: '✅',
      failed: '❌',
      cancelled: '⏹️'
    };
    return statusMap[status] || '❓';
  };

  const getStatusColor = (status: string) => {
    const colorMap: { [key: string]: string } = {
      pending: 'text-yellow-600 bg-yellow-50 border-yellow-200',
      running: 'text-blue-600 bg-blue-50 border-blue-200',
      completed: 'text-green-600 bg-green-50 border-green-200',
      failed: 'text-red-600 bg-red-50 border-red-200',
      cancelled: 'text-gray-600 bg-gray-50 border-gray-200'
    };
    return colorMap[status] || 'text-gray-600 bg-gray-50 border-gray-200';
  };

  const progressPercentage = job.progress && job.progress.totalRows > 0 
    ? Math.round((job.progress.processedRows / job.progress.totalRows) * 100)
    : 0;

  const imageProgressPercentage = job.progress && job.progress.totalImages > 0 
    ? Math.round((job.progress.processedImages / job.progress.totalImages) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`border rounded-lg p-6 ${getStatusColor(job.status)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-3xl mr-4">{getStatusEmoji(job.status)}</span>
            <div>
              <h2 className="text-2xl font-bold capitalize">{job.status}</h2>
              <p className="opacity-75">Transfer Job: {job.id}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm opacity-75">Started</p>
            <p className="font-semibold">
              {job.createdAt ? new Date(job.createdAt).toLocaleString() : 'Unknown'}
            </p>
            {job.completedAt && (
              <>
                <p className="text-sm opacity-75 mt-2">Completed</p>
                <p className="font-semibold">{new Date(job.completedAt).toLocaleString()}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Source & Target Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <span className="mr-2">📊</span>
            Source
          </h3>
          {job.sourceInfo ? (
            <div className="space-y-2">
              <div>
                <p className="text-sm text-gray-600">Spreadsheet</p>
                <p className="font-medium">{job.sourceInfo.spreadsheetTitle}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Tabs</p>
                <p className="font-medium">{job.sourceInfo.tabNames.join(', ')}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Header Row</p>
                <p className="font-medium">Row {job.sourceInfo.headerRowIndex}</p>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">Source information not available</p>
          )}
        </div>

        <div className="bg-white border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <span className="mr-2">🎯</span>
            Target
          </h3>
          {job.targetInfo ? (
            <div className="space-y-2">
              <div>
                <p className="text-sm text-gray-600">Sheet</p>
                <p className="font-medium">{job.targetInfo.sheetName}</p>
              </div>
              {job.targetInfo.workspaceName && (
                <div>
                  <p className="text-sm text-gray-600">Workspace</p>
                  <p className="font-medium">{job.targetInfo.workspaceName}</p>
                </div>
              )}
              {job.targetInfo.folderName && (
                <div>
                  <p className="text-sm text-gray-600">Folder</p>
                  <p className="font-medium">{job.targetInfo.folderName}</p>
                </div>
              )}
              {job.targetInfo.sheetUrl && (
                <div>
                  <a 
                    href={job.targetInfo.sheetUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-blue-600 hover:text-blue-800"
                  >
                    <span className="mr-1">🔗</span>
                    Open Sheet
                  </a>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500">Target information not available</p>
          )}
        </div>
      </div>

      {/* Column Mapping - Concise */}
      {job.columnMappings && job.columnMappings.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center text-blue-800">
            <span className="mr-2">🗂️</span>
            <span className="font-medium">
              📋 Headers detected: {job.columnMappings.length} columns ({job.columnMappings.slice(0, 5).map(m => m.googleColumn).join(', ')}{job.columnMappings.length > 5 ? '...' : ''})
            </span>
          </div>
        </div>
      )}

      {/* Progress Bars */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-6 flex items-center">
          <span className="mr-2">📈</span>
          Progress
        </h3>
        
        <div className="space-y-6">
          {/* Rows Progress */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">Data Rows</span>
              <span className="text-sm text-gray-600">
                {job.progress?.processedRows || 0} / {job.progress?.totalRows || 0} ({progressPercentage}%)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
          </div>

          {/* Images Progress */}
          {job.progress && job.progress.totalImages > 0 && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">Images</span>
                <span className="text-sm text-gray-600">
                  {job.progress.processedImages || 0} / {job.progress.totalImages || 0} ({imageProgressPercentage}%)
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 relative overflow-hidden">
                {/* Successful images - green */}
                <div 
                  className="bg-green-600 h-3 absolute left-0 transition-all duration-300"
                  style={{ 
                    width: `${job.progress.totalImages > 0 ? (job.progress.successfulImages || 0) / job.progress.totalImages * 100 : 0}%` 
                  }}
                ></div>
                {/* Fallback images - orange */}
                <div 
                  className="bg-orange-500 h-3 absolute transition-all duration-300"
                  style={{ 
                    left: `${job.progress.totalImages > 0 ? (job.progress.successfulImages || 0) / job.progress.totalImages * 100 : 0}%`,
                    width: `${job.progress.totalImages > 0 ? (job.progress.fallbackImages || 0) / job.progress.totalImages * 100 : 0}%` 
                  }}
                ></div>
              </div>
              {/* Image processing breakdown */}
              {job.status === 'completed' && (job.progress.successfulImages || job.progress.fallbackImages || job.progress.failedImages) && (
                <div className="flex gap-4 mt-1 text-xs">
                  {(job.progress.successfulImages || 0) > 0 && (
                    <span className="text-green-600">✅ {job.progress.successfulImages} as images</span>
                  )}
                  {(job.progress.fallbackImages || 0) > 0 && (
                    <span className="text-orange-600">🔗 {job.progress.fallbackImages} as links</span>
                  )}
                  {(job.progress.failedImages || 0) > 0 && (
                    <span className="text-red-600">❌ {job.progress.failedImages} failed</span>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Performance Report - Show when completed */}
      {job.status === 'completed' && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <span className="mr-2">📈</span>
            Transfer Report
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* Duration */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-800">Duration</span>
                <span className="text-2xl">⏱️</span>
              </div>
              <p className="text-xl font-bold text-blue-900">
                {job.createdAt && job.completedAt 
                  ? `${Math.round((new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime()) / 1000 / 60)}m`
                  : 'N/A'
                }
              </p>
            </div>

            {/* Success Rate */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-green-800">Success Rate</span>
                <span className="text-2xl">✅</span>
              </div>
              <p className="text-xl font-bold text-green-900">
                {job.progress?.totalRows > 0 
                  ? `${Math.round((job.progress.processedRows / job.progress.totalRows) * 100)}%`
                  : '100%'
                }
              </p>
              <p className="text-xs text-green-700">
                {job.progress?.processedRows || 0} / {job.progress?.totalRows || 0} rows
              </p>
            </div>

            {/* Images Processed */}
            {job.progress && job.progress.totalImages > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-purple-800">Images</span>
                  <span className="text-2xl">🖼️</span>
                </div>
                <p className="text-xl font-bold text-purple-900">
                  {job.progress.successfulImages || 0}
                  {job.progress.fallbackImages && job.progress.fallbackImages > 0 && (
                    <span className="text-sm text-orange-600 ml-1">
                      +{job.progress.fallbackImages} links
                    </span>
                  )}
                </p>
                <p className="text-xs text-purple-700">
                  of {job.progress.totalImages || 0} total
                  {(job.progress.failedImages || 0) > 0 && (
                    <span className="text-red-600">
                      , {job.progress.failedImages} failed
                    </span>
                  )}
                </p>
              </div>
            )}

            {/* Issues */}
            <div className={`border rounded-lg p-4 ${
              (job.progress?.errors?.length || 0) + (job.progress?.warnings?.length || 0) > 0 
                ? 'bg-red-50 border-red-200' 
                : 'bg-gray-50 border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${
                  (job.progress?.errors?.length || 0) + (job.progress?.warnings?.length || 0) > 0 
                    ? 'text-red-800' 
                    : 'text-gray-800'
                }`}>Issues</span>
                <span className="text-2xl">
                  {(job.progress?.errors?.length || 0) + (job.progress?.warnings?.length || 0) > 0 ? '⚠️' : '✨'}
                </span>
              </div>
              <p className={`text-xl font-bold ${
                (job.progress?.errors?.length || 0) + (job.progress?.warnings?.length || 0) > 0 
                  ? 'text-red-900' 
                  : 'text-gray-900'
              }`}>
                {(job.progress?.errors?.length || 0) + (job.progress?.warnings?.length || 0)}
              </p>
              <p className={`text-xs ${
                (job.progress?.errors?.length || 0) + (job.progress?.warnings?.length || 0) > 0 
                  ? 'text-red-700' 
                  : 'text-gray-700'
              }`}>
                {job.progress?.errors?.length || 0} errors, {job.progress?.warnings?.length || 0} warnings
              </p>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-semibold text-gray-800 mb-2">Summary</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-600">
                  <strong>Source:</strong> {job.sourceInfo?.spreadsheetTitle || 'Unknown'}
                </p>
                <p className="text-gray-600">
                  <strong>Sheets:</strong> {job.sourceInfo?.tabNames?.join(', ') || 'Unknown'}
                </p>
                <p className="text-gray-600">
                  <strong>Header Row:</strong> {job.sourceInfo?.headerRowIndex || 'Unknown'}
                </p>
              </div>
              <div>
                <p className="text-gray-600">
                  <strong>Target:</strong> {job.targetInfo?.sheetName || 'Unknown'}
                </p>
                <p className="text-gray-600">
                  <strong>Rows Transferred:</strong> {job.progress?.processedRows || 0}
                </p>
                <p className="text-gray-600">
                  <strong>Images:</strong> {job.progress?.successfulImages || 0} uploaded
                  {(job.progress?.fallbackImages || 0) > 0 && (
                    <>, {job.progress.fallbackImages} as links</>
                  )}
                  {(job.progress?.failedImages || 0) > 0 && (
                    <>, {job.progress.failedImages} failed</>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          {job.targetInfo?.sheetUrl && (
            <div className="flex justify-center mt-6">
              <a 
                href={job.targetInfo.sheetUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <span className="mr-2">🔗</span>
                Open Target Sheet
              </a>
            </div>
          )}
        </div>
      )}

      {/* Failed Transfer Report */}
      {job.status === 'failed' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center text-red-800">
            <span className="mr-2">❌</span>
            Transfer Failed
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-white border border-red-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-red-800">Rows Processed</span>
                <span className="text-2xl">📊</span>
              </div>
              <p className="text-xl font-bold text-red-900">
                {job.progress?.processedRows || 0} / {job.progress?.totalRows || 0}
              </p>
            </div>

            <div className="bg-white border border-red-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-red-800">Images Processed</span>
                <span className="text-2xl">🖼️</span>
              </div>
              <p className="text-xl font-bold text-red-900">
                {job.progress?.processedImages || 0} / {job.progress?.totalImages || 0}
              </p>
            </div>

            <div className="bg-white border border-red-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-red-800">Errors</span>
                <span className="text-2xl">⚠️</span>
              </div>
              <p className="text-xl font-bold text-red-900">
                {job.progress?.errors?.length || 0}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg p-4">
            <p className="text-red-800">
              <strong>Partial Progress:</strong> The transfer was interrupted, but some data may have been successfully transferred to the target sheet.
            </p>
            {job.targetInfo?.sheetUrl && (
              <div className="mt-3">
                <a 
                  href={job.targetInfo.sheetUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-red-600 hover:text-red-800"
                >
                  <span className="mr-2">🔗</span>
                  Check Partial Results in Target Sheet
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activity Log - Collapsible */}
      {job.logs && job.logs.length > 0 && (
        <div className="bg-white border rounded-lg p-6">
          <div 
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setShowActivityLog(!showActivityLog)}
          >
            <h3 className="text-lg font-semibold flex items-center">
              <span className="mr-2">📋</span>
              Activity Log
              <span className="ml-2 text-sm text-gray-500">({job.logs.length} entries)</span>
            </h3>
            <span className={`transform transition-transform duration-200 text-xl ${showActivityLog ? 'rotate-180' : ''}`}>
              ⌄
            </span>
          </div>
          
          {showActivityLog && (
            <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
              {job.logs.slice().reverse().map((log, index) => (
                <div key={index} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                  <span className="text-xl">{log.emoji}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{log.message}</p>
                      <span className="text-xs text-gray-500">
                        {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'Unknown'}
                      </span>
                    </div>
                    {log.details && (
                      <pre className="text-xs text-gray-600 mt-1 bg-gray-100 p-2 rounded overflow-x-auto">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Errors and Warnings */}
      {(job.progress?.errors?.length > 0 || job.progress?.warnings?.length > 0) && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <span className="mr-2">⚠️</span>
            Issues
          </h3>
          
          {job.progress?.errors && job.progress.errors.length > 0 && (
            <div className="mb-4">
              <h4 className="font-medium text-red-800 mb-2">Errors ({job.progress.errors.length})</h4>
              <div className="space-y-2">
                {job.progress.errors.map((error, index) => (
                  <div key={index} className="bg-red-50 border border-red-200 rounded p-3">
                    <p className="text-red-800 font-medium">{error.message}</p>
                    {error.row && <p className="text-red-600 text-sm">Row: {error.row}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {job.progress?.warnings && job.progress.warnings.length > 0 && (
            <div>
              <h4 className="font-medium text-yellow-800 mb-2">Warnings ({job.progress.warnings.length})</h4>
              <div className="space-y-2">
                {job.progress.warnings.map((warning, index) => (
                  <div key={index} className="bg-yellow-50 border border-yellow-200 rounded p-3">
                    <p className="text-yellow-800 font-medium">{warning.message}</p>
                    {warning.count && <p className="text-yellow-600 text-sm">Count: {warning.count}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TransferProgress;