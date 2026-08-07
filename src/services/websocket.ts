import { Server as SocketIOServer } from 'socket.io';
import { TransferJob, TransferLog } from '../types';

/**
 * Job updates are pushed as small deltas rather than whole-job snapshots.
 *
 * The previous implementation emitted the entire job — including the full,
 * ever-growing log array — on every batch. Payload size climbed with job
 * length, so the longest transfers produced the heaviest traffic exactly when
 * they could least afford it.
 *
 * Progress emits are also coalesced: at most one per interval per job, with
 * the latest state always delivered. Terminal events bypass coalescing.
 */

const PROGRESS_EMIT_INTERVAL_MS = 750;

interface PendingUpdate {
  /** Most recent state seen since the last emit; older states are discarded. */
  job: TransferJob;
  /** True once a newer state arrived during the quiet window. */
  superseded: boolean;
  timer: NodeJS.Timeout;
}

class WebSocketService {
  private io?: SocketIOServer;
  private pending = new Map<string, PendingUpdate>();

  public setServer(io: SocketIOServer): void {
    this.io = io;
  }

  private room(jobId: string): string {
    return `job-${jobId}`;
  }

  /** The progress-shaped subset of a job. No logs, no column mappings. */
  private snapshot(job: TransferJob) {
    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      sourceInfo: job.sourceInfo,
      targetInfo: job.targetInfo,
      completedAt: job.completedAt,
      timestamp: new Date().toISOString()
    };
  }

  public emitJobUpdate(jobId: string, job: TransferJob): void {
    if (!this.io) return;

    const pending = this.pending.get(jobId);

    // A window is already open — record the newest state and let the timer
    // deliver it. Intermediate states are intentionally dropped; only the
    // latest matters for a progress bar.
    if (pending) {
      pending.job = job;
      pending.superseded = true;
      return;
    }

    this.io.to(this.room(jobId)).emit('job-update', this.snapshot(job));

    // Open a quiet window. If nothing arrives during it, the entry clears with
    // no further emit; if something does, it is sent when the window closes.
    const entry: PendingUpdate = {
      job,
      superseded: false,
      timer: setTimeout(() => {
        const queued = this.pending.get(jobId);
        this.pending.delete(jobId);
        if (queued?.superseded && this.io) {
          this.io.to(this.room(jobId)).emit('job-update', this.snapshot(queued.job));
        }
      }, PROGRESS_EMIT_INTERVAL_MS)
    };
    entry.timer.unref?.();

    this.pending.set(jobId, entry);
  }

  /** Streams individual log entries so the UI never refetches the history. */
  public emitJobLog(jobId: string, log: TransferLog): void {
    if (!this.io) return;
    this.io.to(this.room(jobId)).emit('job-log', { jobId, log });
  }

  private flush(jobId: string): void {
    const entry = this.pending.get(jobId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.pending.delete(jobId);
  }

  public emitJobCompleted(jobId: string, job: TransferJob): void {
    if (!this.io) return;
    this.flush(jobId);
    this.io.to(this.room(jobId)).emit('job-completed', this.snapshot(job));
  }

  public emitJobFailed(jobId: string, job: TransferJob, error: string): void {
    if (!this.io) return;
    this.flush(jobId);
    this.io.to(this.room(jobId)).emit('job-failed', { ...this.snapshot(job), error });
  }

  public getConnectedClientsCount(jobId: string): number {
    if (!this.io) return 0;

    const room = this.io.sockets.adapter.rooms.get(this.room(jobId));
    return room ? room.size : 0;
  }
}

export const webSocketService = new WebSocketService();
