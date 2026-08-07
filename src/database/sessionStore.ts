import { Store, SessionData } from 'express-session';
import database from './index';

/**
 * express-session store backed by the app's Postgres database.
 *
 * Replaces the default MemoryStore, which loses every session when the process
 * restarts — logging users out mid-transfer — and cannot be shared across
 * processes. Reuses the existing pool rather than opening a second one.
 */
export class PostgresSessionStore extends Store {
  private readonly defaultTtlMs: number;

  constructor(options: { ttlMs: number }) {
    super();
    this.defaultTtlMs = options.ttlMs;

  }

  private expiryFor(session: SessionData): number {
    const cookieExpires = session.cookie?.expires;
    if (cookieExpires) {
      const at = new Date(cookieExpires).getTime();
      if (Number.isFinite(at)) return at;
    }
    return Date.now() + this.defaultTtlMs;
  }

  public get(
    sid: string,
    callback: (err?: any, session?: SessionData | null) => void
  ): void {
    database
      .sessionGet(sid)
      .then(data => callback(null, data ? (JSON.parse(data) as SessionData) : null))
      .catch(callback);
  }

  public set(sid: string, session: SessionData, callback?: (err?: any) => void): void {
    database
      .sessionSet(sid, JSON.stringify(session), this.expiryFor(session))
      .then(() => callback?.(null))
      .catch(error => callback?.(error));
  }

  public touch(sid: string, session: SessionData, callback?: (err?: any) => void): void {
    database
      .sessionTouch(sid, this.expiryFor(session))
      .then(() => callback?.(null))
      .catch(error => {
        console.error('Session touch failed:', error);
        callback?.(error);
      });
  }

  public destroy(sid: string, callback?: (err?: any) => void): void {
    database
      .sessionDestroy(sid)
      .then(() => callback?.(null))
      .catch(error => callback?.(error));
  }
}
