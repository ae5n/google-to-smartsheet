import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { transferAPI } from '../services/api';
import { TransferJob, TransferLog } from '../types';

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'polling' | 'offline';

const TERMINAL = ['completed', 'completed_with_errors', 'failed', 'cancelled'];

const POLL_MIN_MS = 4000;
const POLL_MAX_MS = 60000;
const SESSION_EXPIRED_MESSAGE = 'Your session expired. Sign in again to continue viewing live updates.';

const isUnauthorized = (error: any): boolean =>
  error?.response?.status === 401 || error?.message === 'unauthorized';

/**
 * Keeps a transfer job in sync with the server.
 *
 * Design notes, all of them fixes for how this used to behave:
 *
 *  - Polling exists *only* while the socket is down. The previous version
 *    started an interval on the first disconnect and never cleared it on
 *    reconnect, so one blip left the client polling forever while also holding
 *    a live socket — double traffic straight into the server's rate limiter.
 *  - Poll interval backs off on repeated failures and honours the server's
 *    Retry-After on 429, instead of hammering a fixed 30s regardless.
 *  - Logs stream in as individual entries and are reconciled by sequence
 *    number, so a reconnect fetches only what was missed.
 */
export function useJobStream(jobId: string) {
  const [job, setJob] = useState<TransferJob | null>(null);
  const [logs, setLogs] = useState<TransferLog[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollDelayRef = useRef(POLL_MIN_MS);
  const lastSeqRef = useRef(0);
  const activeRef = useRef(true);
  const jobRef = useRef<TransferJob | null>(null);

  const isTerminal = useCallback(
    () => Boolean(jobRef.current && TERMINAL.includes(jobRef.current.status)),
    []
  );

  const applyJob = useCallback((next: TransferJob) => {
    jobRef.current = next;
    setJob(next);
    // A successful socket event or poll recovers a transient initial failure.
    setError(null);
  }, []);

  /** Merges entries by seq; tolerates duplicates from overlapping sources. */
  const mergeLogs = useCallback((incoming: TransferLog[]) => {
    if (incoming.length === 0) return;

    setLogs(prev => {
      const seen = new Set(prev.map(l => l.seq).filter(s => s !== undefined));
      const fresh = incoming.filter(l => l.seq === undefined || !seen.has(l.seq));
      if (fresh.length === 0) return prev;

      const merged = [...prev, ...fresh];
      merged.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      return merged;
    });

    const maxSeq = Math.max(...incoming.map(l => l.seq ?? 0));
    if (maxSeq > lastSeqRef.current) lastSeqRef.current = maxSeq;
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const response = await transferAPI.getJobLogs(jobId, lastSeqRef.current);
      if (response.data.success && response.data.data) {
        mergeLogs(response.data.data.logs);
      }
    } catch {
      // Non-fatal: the socket or the next poll will catch us up.
    }
  }, [jobId, mergeLogs]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollDelayRef.current = POLL_MIN_MS;
  }, []);

  const scheduleNextPoll = useCallback((delayMs: number, poll: () => void) => {
    if (!activeRef.current || isTerminal()) return;
    pollTimerRef.current = setTimeout(poll, delayMs);
  }, [isTerminal]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current || !activeRef.current || isTerminal()) return;

    const poll = async () => {
      pollTimerRef.current = null;
      if (!activeRef.current) return;

      try {
        const response = await transferAPI.getJob(jobId);
        if (!activeRef.current) return;

        if (response.data.success && response.data.data) {
          applyJob(response.data.data);
          pollDelayRef.current = POLL_MIN_MS; // healthy again
        }

        await fetchLogs();

        if (isTerminal()) {
          stopPolling();
          return;
        }
      } catch (err: any) {
        if (isUnauthorized(err)) {
          setError(SESSION_EXPIRED_MESSAGE);
          setStatus('offline');
          stopPolling();
          return;
        }

        // Respect an explicit backoff instruction; otherwise widen the gap so
        // a struggling server is not made worse by our retries.
        const retryAfterMs = err?.retryAfterMs;
        pollDelayRef.current = retryAfterMs
          ? Math.min(POLL_MAX_MS, retryAfterMs)
          : Math.min(POLL_MAX_MS, pollDelayRef.current * 2);
      }

      scheduleNextPoll(pollDelayRef.current, poll);
    };

    void poll();
  }, [applyJob, fetchLogs, isTerminal, jobId, scheduleNextPoll, stopPolling]);

  useEffect(() => {
    activeRef.current = true;
    lastSeqRef.current = 0;
    setLogs([]);
    setLoading(true);
    setError(null);

    const loadInitial = async () => {
      try {
        const response = await transferAPI.getJob(jobId);
        if (!activeRef.current) return;

        if (response.data.success && response.data.data) {
          applyJob(response.data.data);
          // Job reads intentionally exclude the append-only log history.
          await fetchLogs();
        } else {
          setError(response.data.error || 'Failed to load transfer');
        }
      } catch (err: any) {
        if (activeRef.current) {
          if (isUnauthorized(err)) {
            setStatus('offline');
            setError(SESSION_EXPIRED_MESSAGE);
          } else {
            setError(err.message || 'Failed to load transfer');
          }
        }
      } finally {
        if (activeRef.current) setLoading(false);
      }
    };

    void loadInitial();

    const serverUrl =
      process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : window.location.origin;

    const socket = io(serverUrl, {
      withCredentials: true, // session cookie — the server authenticates sockets
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000,
      timeout: 20000
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      if (!activeRef.current) return;

      socket.emit('join-job', jobId, (ack: { ok: boolean; error?: string }) => {
        if (!activeRef.current) return;

        if (ack?.ok) {
          setStatus('live');
          // The socket is authoritative again — polling must stop, or we pay
          // for both channels at once.
          stopPolling();
          // Catch up on anything emitted while we were away.
          void fetchLogs();
        } else {
          setStatus('polling');
          startPolling();
        }
      });
    });

    socket.on('disconnect', () => {
      if (!activeRef.current || isTerminal()) return;
      setStatus('reconnecting');
      startPolling();
    });

    socket.on('connect_error', (socketError) => {
      if (!activeRef.current || isTerminal()) return;

      if (isUnauthorized(socketError)) {
        setStatus('offline');
        setError(SESSION_EXPIRED_MESSAGE);
        stopPolling();
        socket.disconnect();
        return;
      }

      setStatus('polling');
      startPolling();
    });

    const onProgress = (data: any) => {
      if (!activeRef.current || data.jobId !== jobId) return;
      // Initial loading is concurrent with socket setup. If an update wins the
      // race, the initial request will shortly provide the complete job; do
      // not manufacture a partial TransferJob that can break the UI.
      if (!jobRef.current) return;
      // Progress arrives as a delta, so merge it onto what we already hold
      // rather than replacing the whole job.
      applyJob({ ...jobRef.current, ...data, id: jobId });
    };

    socket.on('job-update', onProgress);
    socket.on('job-completed', (data: any) => {
      onProgress(data);
      stopPolling();
    });
    socket.on('job-failed', (data: any) => {
      onProgress(data);
      stopPolling();
    });

    socket.on('job-log', (data: { jobId: string; log: TransferLog }) => {
      if (!activeRef.current || data.jobId !== jobId) return;
      mergeLogs([data.log]);
    });

    return () => {
      activeRef.current = false;
      stopPolling();
      socket.emit('leave-job', jobId);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [jobId, applyJob, mergeLogs, fetchLogs, startPolling, stopPolling, isTerminal]);

  return { job, logs, status, loading, error };
}
