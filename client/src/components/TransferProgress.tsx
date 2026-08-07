import React, { useMemo, useState } from 'react';
import { useJobStream, StreamStatus } from '../hooks/useJobStream';
import TransferLedger from './TransferLedger';
import { TransferLog, TransferStatus } from '../types';

interface TransferProgressProps {
  jobId: string;
}

const TERMINAL: TransferStatus[] = ['completed', 'completed_with_errors', 'failed', 'cancelled'];

const STATUS_META: Record<TransferStatus, { emoji: string; label: string; classes: string }> = {
  pending: { emoji: '⏳', label: 'Pending', classes: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
  running: { emoji: '🔄', label: 'Running', classes: 'text-blue-700 bg-blue-50 border-blue-200' },
  completed: { emoji: '✅', label: 'Completed', classes: 'text-green-700 bg-green-50 border-green-200' },
  completed_with_errors: {
    emoji: '⚠️',
    label: 'Completed with errors',
    classes: 'text-orange-700 bg-orange-50 border-orange-200'
  },
  failed: { emoji: '❌', label: 'Failed', classes: 'text-red-700 bg-red-50 border-red-200' },
  cancelled: { emoji: '⏹️', label: 'Cancelled', classes: 'text-gray-700 bg-gray-50 border-gray-200' }
};

const CONNECTION_META: Record<StreamStatus, { emoji: string; text: string; classes: string } | null> = {
  live: null, // the happy path needs no banner
  connecting: {
    emoji: '🔄',
    text: 'Connecting to live updates...',
    classes: 'bg-blue-50 border-blue-200 text-blue-800'
  },
  reconnecting: {
    emoji: '🔌',
    text: 'Live connection dropped — reconnecting, and refreshing periodically in the meantime',
    classes: 'bg-yellow-50 border-yellow-200 text-yellow-800'
  },
  polling: {
    emoji: '⚠️',
    text: 'Live updates unavailable — refreshing periodically instead',
    classes: 'bg-yellow-50 border-yellow-200 text-yellow-800'
  },
  offline: {
    emoji: '🚫',
    text: 'Cannot reach the server',
    classes: 'bg-red-50 border-red-200 text-red-800'
  }
};

const LOG_LEVEL_STYLE: Record<string, string> = {
  info: 'text-gray-700',
  success: 'text-green-700',
  warn: 'text-orange-700',
  error: 'text-red-700'
};

const formatDuration = (startIso?: string, endIso?: string): string => {
  if (!startIso || !endIso) return '—';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

function TransferProgress({ jobId }: TransferProgressProps) {
  const { job, logs, status: streamStatus, loading, error } = useJobStream(jobId);
  const [showLog, setShowLog] = useState(false);
  const [logFilter, setLogFilter] = useState<string>('');

  const isTerminal = job ? TERMINAL.includes(job.status) : false;

  const filteredLogs = useMemo(
    () => (logFilter ? logs.filter((l: TransferLog) => l.level === logFilter) : logs),
    [logs, logFilter]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Loading transfer details...</span>
      </div>
    );
  }

  if (error && !job) {
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

  const progress = job.progress || {
    totalRows: 0,
    processedRows: 0,
    totalImages: 0,
    processedImages: 0,
    errors: [],
    warnings: []
  };

  // "Transferred" means Smartsheet confirmed the row. Attempted-but-unconfirmed
  // rows are shown separately rather than folded into the success figure.
  const insertedRows = progress.insertedRows ?? 0;
  const failedRows = progress.failedRows ?? 0;
  const totalRows = progress.totalRows || 0;

  const rowPercent = totalRows > 0 ? Math.round((insertedRows / totalRows) * 100) : 0;
  const failedPercent = totalRows > 0 ? Math.round((failedRows / totalRows) * 100) : 0;

  const embedded = progress.successfulImages ?? 0;
  const asLinks = progress.fallbackImages ?? 0;
  const imagesFailed = progress.failedImages ?? 0;
  const totalImages = progress.totalImages || 0;

  const meta = STATUS_META[job.status] || STATUS_META.pending;
  const connection = CONNECTION_META[streamStatus];

  return (
    <div className="space-y-6">
      {error && (
        <div className="border rounded-lg p-3 bg-red-50 border-red-200 text-red-800">
          <div className="flex items-center text-sm">
            <span className="mr-2" aria-hidden="true">&#9888;</span>
            {error}
          </div>
        </div>
      )}

      {connection && !isTerminal && (
        <div className={`border rounded-lg p-3 ${connection.classes}`}>
          <div className="flex items-center text-sm">
            <span className="mr-2">{connection.emoji}</span>
            {connection.text}
          </div>
        </div>
      )}

      {/* Header */}
      <div className={`border rounded-lg p-6 ${meta.classes}`}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center">
            <span className="text-3xl mr-4">{meta.emoji}</span>
            <div>
              <h2 className="text-2xl font-bold">{meta.label}</h2>
              <p className="opacity-75 text-sm">Transfer Job: {job.id}</p>
              {job.status === 'running' && progress.currentTab && (
                <p className="opacity-75 text-sm mt-1">
                  Working on “{progress.currentTab}”
                  {progress.currentBatch && progress.totalBatches
                    ? ` — batch ${progress.currentBatch} of ${progress.totalBatches}`
                    : ''}
                </p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm opacity-75">Started</p>
            <p className="font-semibold">
              {job.createdAt ? new Date(job.createdAt).toLocaleString() : 'Unknown'}
            </p>
            {job.completedAt && (
              <>
                <p className="text-sm opacity-75 mt-2">Finished</p>
                <p className="font-semibold">{new Date(job.completedAt).toLocaleString()}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Headline figures — each one an outcome, not an intention */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Rows transferred</p>
          <p className="text-2xl font-bold text-green-700">
            {insertedRows}
            <span className="text-base font-normal text-gray-500"> / {totalRows}</span>
          </p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Rows not transferred</p>
          <p className={`text-2xl font-bold ${failedRows > 0 ? 'text-red-700' : 'text-gray-400'}`}>
            {failedRows}
          </p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Images embedded</p>
          <p className="text-2xl font-bold text-green-700">
            {embedded}
            <span className="text-base font-normal text-gray-500"> / {totalImages}</span>
          </p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Duration</p>
          <p className="text-2xl font-bold text-gray-800">
            {formatDuration(job.createdAt, job.completedAt || (isTerminal ? undefined : new Date().toISOString()))}
          </p>
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
              {job.targetInfo.sheetUrl && (
                <a
                  href={job.targetInfo.sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-blue-600 hover:text-blue-800"
                >
                  <span className="mr-1">🔗</span>
                  Open Sheet
                </a>
              )}
            </div>
          ) : (
            <p className="text-gray-500">Target information not available</p>
          )}
        </div>
      </div>

      {/* Progress bars */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-6 flex items-center">
          <span className="mr-2">📈</span>
          Progress
        </h3>

        <div className="space-y-6">
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">Data rows</span>
              <span className="text-sm text-gray-600">
                {insertedRows} transferred
                {failedRows > 0 && <span className="text-red-600"> · {failedRows} failed</span>}
                {' '}of {totalRows} ({rowPercent}%)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 relative overflow-hidden">
              <div
                className="bg-green-600 h-3 absolute left-0 transition-all duration-300"
                style={{ width: `${rowPercent}%` }}
              />
              <div
                className="bg-red-500 h-3 absolute transition-all duration-300"
                style={{ left: `${rowPercent}%`, width: `${failedPercent}%` }}
              />
            </div>
          </div>

          {totalImages > 0 && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-gray-700">Images</span>
                <span className="text-sm text-gray-600">
                  {progress.processedImages} of {totalImages} resolved
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 relative overflow-hidden">
                <div
                  className="bg-green-600 h-3 absolute left-0 transition-all duration-300"
                  style={{ width: `${(embedded / totalImages) * 100}%` }}
                />
                <div
                  className="bg-orange-500 h-3 absolute transition-all duration-300"
                  style={{
                    left: `${(embedded / totalImages) * 100}%`,
                    width: `${(asLinks / totalImages) * 100}%`
                  }}
                />
                <div
                  className="bg-red-500 h-3 absolute transition-all duration-300"
                  style={{
                    left: `${((embedded + asLinks) / totalImages) * 100}%`,
                    width: `${(imagesFailed / totalImages) * 100}%`
                  }}
                />
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-xs">
                <span className="text-green-700">✅ {embedded} embedded</span>
                {asLinks > 0 && <span className="text-orange-700">🔗 {asLinks} stored as links</span>}
                {imagesFailed > 0 && <span className="text-red-700">❌ {imagesFailed} failed</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The authoritative record */}
      <TransferLedger jobId={jobId} revision={isTerminal ? 1 : 0} />

      {/* Activity log */}
      <div className="bg-white border rounded-lg p-6">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setShowLog(!showLog)}
        >
          <h3 className="text-lg font-semibold flex items-center">
            <span className="mr-2">📋</span>
            Activity Log
            <span className="ml-2 text-sm text-gray-500">({logs.length} entries)</span>
          </h3>
          <span
            className={`transform transition-transform duration-200 text-xl ${
              showLog ? 'rotate-180' : ''
            }`}
          >
            ⌄
          </span>
        </div>

        {showLog && (
          <>
            <div className="flex flex-wrap gap-2 mt-4">
              {['', 'success', 'info', 'warn', 'error'].map(level => (
                <button
                  key={level || 'all'}
                  onClick={() => setLogFilter(level)}
                  className={`px-3 py-1 rounded-full text-sm border capitalize ${
                    logFilter === level
                      ? 'border-blue-500 bg-blue-50 text-blue-800'
                      : 'border-gray-200 text-gray-700'
                  }`}
                >
                  {level || 'all'} ({level ? logs.filter(l => l.level === level).length : logs.length})
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
              {filteredLogs
                .slice()
                .reverse()
                .map((log, index) => (
                  <div
                    key={log.seq ?? index}
                    className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg"
                  >
                    <span className="text-lg">{log.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={`font-medium ${LOG_LEVEL_STYLE[log.level] || ''}`}>
                          {log.message}
                        </p>
                        <span className="text-xs text-gray-500 whitespace-nowrap">
                          {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}
                        </span>
                      </div>
                      {log.details && (
                        <p className="text-xs text-gray-600 mt-1">
                          {Object.entries(log.details)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              {filteredLogs.length === 0 && (
                <p className="text-sm text-gray-500 py-3">No entries at this level.</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Errors and warnings */}
      {(progress.errors?.length > 0 || progress.warnings?.length > 0) && (
        <div className="bg-white border rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <span className="mr-2">⚠️</span>
            Issues
          </h3>

          {progress.errors?.length > 0 && (
            <div className="mb-4">
              <h4 className="font-medium text-red-800 mb-2">Errors ({progress.errors.length})</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {progress.errors.slice(0, 100).map((err, index) => (
                  <div key={index} className="bg-red-50 border border-red-200 rounded p-3">
                    <p className="text-red-800 font-medium text-sm">{err.message}</p>
                    <p className="text-red-600 text-xs mt-1">
                      {err.tab && <>Tab: {err.tab} · </>}
                      {err.row !== undefined && <>Source row {err.row} · </>}
                      {err.type}
                    </p>
                  </div>
                ))}
                {progress.errors.length > 100 && (
                  <p className="text-xs text-gray-500">
                    Showing the first 100. Export the transfer record for all of them.
                  </p>
                )}
              </div>
            </div>
          )}

          {progress.warnings?.length > 0 && (
            <div>
              <h4 className="font-medium text-yellow-800 mb-2">
                Warnings ({progress.warnings.length})
              </h4>
              <div className="space-y-2">
                {progress.warnings.map((warning, index) => (
                  <div key={index} className="bg-yellow-50 border border-yellow-200 rounded p-3">
                    <p className="text-yellow-800 font-medium text-sm">{warning.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {job.targetInfo?.sheetUrl && isTerminal && (
        <div className="flex justify-center">
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
  );
}

export default TransferProgress;
