import React, { useCallback, useEffect, useState } from 'react';
import { transferAPI } from '../services/api';
import {
  ImageResultRecord,
  LedgerSummary,
  RowResultRecord
} from '../types';

interface TransferLedgerProps {
  jobId: string;
  /** Refetch trigger: bump when the job reaches a terminal state. */
  revision: number;
}

type Kind = 'rows' | 'images';

const ROW_STATUS_STYLE: Record<string, string> = {
  inserted: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-gray-100 text-gray-700'
};

const IMAGE_STATUS_STYLE: Record<string, string> = {
  embedded: 'bg-green-100 text-green-800',
  link_fallback: 'bg-orange-100 text-orange-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-gray-100 text-gray-700'
};

const STATUS_LABEL: Record<string, string> = {
  inserted: 'Transferred',
  failed: 'Failed',
  skipped: 'Skipped',
  embedded: 'Embedded image',
  link_fallback: 'Stored as link'
};

/**
 * The record of what actually landed in Smartsheet, row by row.
 *
 * Every figure here comes from the server's audit ledger — rows are counted
 * only once Smartsheet has returned a target row id for them — so this panel
 * can be used as evidence rather than as an estimate.
 */
const TransferLedger: React.FC<TransferLedgerProps> = ({ jobId, revision }) => {
  const [kind, setKind] = useState<Kind>('rows');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [entries, setEntries] = useState<Array<RowResultRecord | ImageResultRecord>>([]);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await transferAPI.getJobLedger(jobId, {
        kind,
        status: statusFilter || undefined,
        limit: 500
      });
      if (response.data.success && response.data.data) {
        setEntries(response.data.data.entries);
        setSummary(response.data.data.summary);
      } else {
        setError(response.data.error || 'Failed to load the transfer record');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load the transfer record');
    } finally {
      setLoading(false);
    }
  }, [jobId, kind, statusFilter]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const counts = (kind === 'rows' ? summary?.rows : summary?.images) || {};
  const statuses = Object.keys(counts);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="bg-white border rounded-lg p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold flex items-center">
          <span className="mr-2">🧾</span>
          Transfer Record
        </h3>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border overflow-hidden">
            {(['rows', 'images'] as Kind[]).map(option => (
              <button
                key={option}
                onClick={() => {
                  setKind(option);
                  setStatusFilter('');
                }}
                className={`px-3 py-1.5 text-sm capitalize ${
                  kind === option ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <a
            href={transferAPI.ledgerCsvUrl(jobId, kind, statusFilter || undefined)}
            className="px-3 py-1.5 text-sm border rounded-lg text-gray-700 hover:bg-gray-50"
          >
            ⬇ Export CSV
          </a>
        </div>
      </div>

      {/* Status tallies double as filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setStatusFilter('')}
          className={`px-3 py-1 rounded-full text-sm border ${
            statusFilter === '' ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-200 text-gray-700'
          }`}
        >
          All ({total})
        </button>
        {statuses.map(status => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1 rounded-full text-sm border ${
              statusFilter === status
                ? 'border-blue-500 bg-blue-50 text-blue-800'
                : 'border-gray-200 text-gray-700'
            }`}
          >
            {STATUS_LABEL[status] || status} ({counts[status]})
          </button>
        ))}
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {loading ? (
        <p className="text-gray-500 text-sm py-4">Loading record...</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-500 text-sm py-4">
          {total === 0
            ? 'No rows have been recorded for this transfer yet.'
            : 'No entries match this filter.'}
        </p>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-left text-gray-600">
                <th className="px-3 py-2 font-medium">Tab</th>
                <th className="px-3 py-2 font-medium">Source row</th>
                {kind === 'images' && <th className="px-3 py-2 font-medium">Column</th>}
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 font-medium">Smartsheet row</th>
                <th className="px-3 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry, index) => {
                const styles = kind === 'rows' ? ROW_STATUS_STYLE : IMAGE_STATUS_STYLE;
                const image = entry as ImageResultRecord;
                const row = entry as RowResultRecord;

                return (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700">{entry.tabName}</td>
                    <td className="px-3 py-2 font-mono text-gray-900">{entry.sourceRowNumber}</td>
                    {kind === 'images' && (
                      <td className="px-3 py-2 text-gray-700">{image.sourceColumn || '—'}</td>
                    )}
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs ${
                          styles[entry.status] || 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {STATUS_LABEL[entry.status] || entry.status}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2 font-mono text-xs text-gray-600"
                      title={entry.targetRowId ? `Smartsheet row ID: ${entry.targetRowId}` : undefined}
                    >
                      {kind === 'rows'
                        ? row.targetRowNumber ?? row.targetRowId ?? '—'
                        : image.targetRowNumber ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 max-w-md truncate" title={entry.error}>
                      {entry.error || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entries.length >= 500 && (
        <p className="text-xs text-gray-500 mt-2">
          Showing the first 500 entries. Export the CSV for the complete record.
        </p>
      )}
    </div>
  );
};

export default TransferLedger;
