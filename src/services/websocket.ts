import { Server as SocketIOServer } from 'socket.io';
import { TransferJob } from '../types';

class WebSocketService {
  private io?: SocketIOServer;

  public setServer(io: SocketIOServer): void {
    this.io = io;
  }

  public emitJobUpdate(jobId: string, job: TransferJob): void {
    if (!this.io) return;
    
    // Emit to all clients listening to this specific job
    this.io.to(`job-${jobId}`).emit('job-update', {
      jobId,
      job,
      timestamp: new Date().toISOString()
    });

  }

  public emitJobCompleted(jobId: string, job: TransferJob): void {
    if (!this.io) return;
    
    this.io.to(`job-${jobId}`).emit('job-completed', {
      jobId,
      job,
      timestamp: new Date().toISOString()
    });
  }

  public emitJobFailed(jobId: string, job: TransferJob, error: string): void {
    if (!this.io) return;
    
    this.io.to(`job-${jobId}`).emit('job-failed', {
      jobId,
      job,
      error,
      timestamp: new Date().toISOString()
    });
  }

  public getConnectedClientsCount(jobId: string): number {
    if (!this.io) return 0;
    
    const room = this.io.sockets.adapter.rooms.get(`job-${jobId}`);
    return room ? room.size : 0;
  }
}

export const webSocketService = new WebSocketService();