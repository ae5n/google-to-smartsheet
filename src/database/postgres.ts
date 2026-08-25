import { Pool, types } from 'pg';
import config from '../config';
import { startDatabaseMaintenance } from './maintenance';
import {
  User,
  TransferJob,
  TransferLog,
  SourceInfo,
  TargetInfo,
  ImageCache,
  OAuthState,
  RowResultRecord,
  ImageResultRecord,
  LedgerSummary
} from '../types';

/**
 * node-postgres returns BIGINT as a string to avoid silent precision loss.
 * Every bigint we store is either a Smartsheet id (~6.1e15) or one of our own
 * sequence values, all comfortably inside Number.MAX_SAFE_INTEGER (9.0e15),
 * and the rest of the codebase types them as `number` — so parse them here
 * rather than threading string conversions through every read.
 */
types.setTypeParser(types.builtins.INT8, value => parseInt(value, 10));

/** JSONB params must be stringified explicitly: node-postgres would otherwise
 *  map a JS array onto a Postgres array rather than a JSON document. */
const toJson = (value: unknown): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value);

/** Tolerates both jsonb (already parsed) and legacy text columns. */
const fromJson = <T>(value: any, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
};

const TERMINAL_STATUSES = ['completed', 'completed_with_errors', 'failed', 'cancelled'];

class PostgresDatabaseManager {
  private pool: Pool;

  constructor() {
    const connectionString = config.database.url;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — a Postgres connection string is required');
    }

    const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);

    this.pool = new Pool({
      connectionString,
      // Managed providers (Neon, RDS, Render) all require TLS and present
      // valid certificates; only a local dev database is plaintext.
      ssl: isLocal ? undefined : { rejectUnauthorized: true },
      max: config.database.poolSize,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });

    this.pool.on('error', error => {
      // A pooled connection dropped while idle (Neon scales to zero). The pool
      // replaces it on the next checkout; log rather than crash the process.
      console.error('Postgres idle client error:', error.message);
    });
  }

  private async query<T = any>(text: string, params: any[] = []): Promise<T[]> {
    const result = await this.pool.query(text, params);
    return result.rows as T[];
  }

  public async initialize(): Promise<void> {
    await this.createTables();
    console.log('Postgres database initialized successfully');
  }

  private async createTables(): Promise<void> {
    // Every statement is idempotent, so this runs safely on each boot and
    // doubles as the migration path for an existing database.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        avatar TEXT,
        google_tokens JSONB,
        smartsheet_tokens JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transfer_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users (id),
        google_spreadsheet_id TEXT NOT NULL,
        google_sheet_tabs JSONB NOT NULL,
        -- Smartsheet ids are ~16 digits and overflow a 4-byte integer.
        smartsheet_id BIGINT NOT NULL,
        column_mappings JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        progress JSONB,
        dry_run BOOLEAN NOT NULL DEFAULT FALSE,
        header_row_index INTEGER,
        selected_columns JSONB,
        source_info JSONB,
        target_info JSONB,
        cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Additive migration for databases created before heartbeat tracking.
      ALTER TABLE transfer_jobs
        ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

      CREATE TABLE IF NOT EXISTS transfer_logs (
        id BIGSERIAL PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES transfer_jobs (id) ON DELETE CASCADE,
        timestamp TIMESTAMPTZ NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        emoji TEXT,
        details JSONB
      );

      CREATE TABLE IF NOT EXISTS transfer_row_results (
        id BIGSERIAL PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES transfer_jobs (id) ON DELETE CASCADE,
        tab_name TEXT NOT NULL,
        source_row_number INTEGER NOT NULL,
        target_row_id BIGINT,
        target_row_number INTEGER,
        status TEXT NOT NULL,
        error TEXT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS transfer_image_results (
        id BIGSERIAL PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES transfer_jobs (id) ON DELETE CASCADE,
        tab_name TEXT NOT NULL,
        source_row_number INTEGER NOT NULL,
        source_column TEXT,
        target_row_id BIGINT,
        target_column_id BIGINT,
        image_url TEXT,
        status TEXT NOT NULL,
        error TEXT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS image_cache (
        hash TEXT PRIMARY KEY,
        smartsheet_image_id TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        expires_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        user_id TEXT,
        code_verifier TEXT,
        redirect_uri TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
      CREATE INDEX IF NOT EXISTS idx_transfer_jobs_user_id ON transfer_jobs (user_id);
      CREATE INDEX IF NOT EXISTS idx_transfer_jobs_status ON transfer_jobs (status);
      CREATE INDEX IF NOT EXISTS idx_transfer_jobs_created_at ON transfer_jobs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_transfer_jobs_running_heartbeat
        ON transfer_jobs (heartbeat_at) WHERE status = 'running';
      CREATE INDEX IF NOT EXISTS idx_oauth_states_created_at ON oauth_states (created_at);
      CREATE INDEX IF NOT EXISTS idx_transfer_logs_job ON transfer_logs (job_id, id);
      CREATE INDEX IF NOT EXISTS idx_row_results_job ON transfer_row_results (job_id, tab_name, source_row_number);
      CREATE INDEX IF NOT EXISTS idx_row_results_status ON transfer_row_results (job_id, status);
      CREATE INDEX IF NOT EXISTS idx_image_results_job ON transfer_image_results (job_id, tab_name, source_row_number);
      CREATE INDEX IF NOT EXISTS idx_image_results_status ON transfer_image_results (job_id, status);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
    `);
  }

  // --- Users ---

  public async createUser(user: Omit<User, 'createdAt' | 'updatedAt'>): Promise<User> {
    const rows = await this.query(
      `INSERT INTO users (id, email, name, google_tokens, smartsheet_tokens)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING created_at, updated_at`,
      [
        user.id,
        user.email,
        user.name,
        toJson(user.googleTokens),
        toJson(user.smartsheetTokens)
      ]
    );

    return {
      ...user,
      createdAt: rows[0].created_at,
      updatedAt: rows[0].updated_at
    };
  }

  public async getUserById(id: string): Promise<User | null> {
    const rows = await this.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return rows.length > 0 ? this.parseUserRow(rows[0]) : null;
  }

  public async getUserByEmail(email: string): Promise<User | null> {
    const rows = await this.query(`SELECT * FROM users WHERE email = $1`, [email]);
    return rows.length > 0 ? this.parseUserRow(rows[0]) : null;
  }

  public async updateUserTokens(
    userId: string,
    provider: 'google' | 'smartsheet',
    tokens: any
  ): Promise<void> {
    const column = provider === 'google' ? 'google_tokens' : 'smartsheet_tokens';
    await this.query(
      `UPDATE users SET ${column} = $1, updated_at = NOW() WHERE id = $2`,
      [toJson(tokens), userId]
    );
  }

  private parseUserRow(row: any): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      googleTokens: fromJson(row.google_tokens, undefined),
      smartsheetTokens: fromJson(row.smartsheet_tokens, undefined),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // --- Transfer jobs ---

  public async createTransferJob(
    job: Omit<TransferJob, 'createdAt' | 'completedAt'>
  ): Promise<TransferJob> {
    const rows = await this.query(
      `INSERT INTO transfer_jobs (
         id, user_id, google_spreadsheet_id, google_sheet_tabs, smartsheet_id,
         column_mappings, status, progress, dry_run, header_row_index, selected_columns
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING created_at`,
      [
        job.id,
        job.userId,
        job.googleSpreadsheetId,
        toJson(job.googleSheetTabs),
        job.smartsheetId,
        toJson(job.columnMappings),
        job.status,
        toJson(job.progress),
        job.dryRun,
        job.headerRowIndex ?? null,
        toJson(job.selectedColumns)
      ]
    );

    return { ...job, createdAt: rows[0].created_at };
  }

  /**
   * Logs are excluded by default. They live in their own table and can run to
   * thousands of entries; attaching them to every read would make each
   * WebSocket progress emit re-send the whole job history.
   */
  public async getTransferJobById(
    id: string,
    options: { includeLogs?: boolean } = {}
  ): Promise<TransferJob | null> {
    const rows = await this.query(`SELECT * FROM transfer_jobs WHERE id = $1`, [id]);
    if (rows.length === 0) return null;

    const job = this.parseTransferJobRow(rows[0]);
    if (options.includeLogs) {
      job.logs = await this.getTransferLogs(id);
    }
    return job;
  }

  public async updateTransferJobStatus(
    id: string,
    status: TransferJob['status'],
    progress?: TransferJob['progress']
  ): Promise<void> {
    const sets = ['status = $1', 'heartbeat_at = NOW()'];
    const params: any[] = [status];

    if (progress) {
      params.push(toJson(progress));
      sets.push(`progress = $${params.length}`);
    }

    // `completed_with_errors` is terminal too — omitting it left those jobs
    // with no finish time, so the UI could not show a duration.
    if (TERMINAL_STATUSES.includes(status)) {
      sets.push('completed_at = NOW()');
    }

    params.push(id);
    await this.query(
      `UPDATE transfer_jobs SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
  }

  public async updateTransferJobInfo(
    id: string,
    sourceInfo?: SourceInfo,
    targetInfo?: TargetInfo
  ): Promise<void> {
    const sets: string[] = ['heartbeat_at = NOW()'];
    const params: any[] = [];

    if (sourceInfo) {
      params.push(toJson(sourceInfo));
      sets.push(`source_info = $${params.length}`);
    }

    if (targetInfo) {
      params.push(toJson(targetInfo));
      sets.push(`target_info = $${params.length}`);
    }

    params.push(id);
    await this.query(
      `UPDATE transfer_jobs SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
  }

  public async getUserTransferJobs(userId: string, limit: number = 50): Promise<TransferJob[]> {
    const rows = await this.query(
      `SELECT * FROM transfer_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return rows.map(row => this.parseTransferJobRow(row));
  }

  private parseTransferJobRow(row: any): TransferJob {
    return {
      id: row.id,
      userId: row.user_id,
      googleSpreadsheetId: row.google_spreadsheet_id,
      googleSheetTabs: fromJson(row.google_sheet_tabs, [] as string[]),
      smartsheetId: row.smartsheet_id,
      columnMappings: fromJson(row.column_mappings, []),
      status: row.status,
      progress: fromJson(row.progress, {
        totalRows: 0,
        processedRows: 0,
        totalImages: 0,
        processedImages: 0,
        errors: [],
        warnings: []
      }),
      logs: [],
      cancelRequested: Boolean(row.cancel_requested),
      dryRun: Boolean(row.dry_run),
      headerRowIndex: row.header_row_index ?? undefined,
      selectedColumns: fromJson(row.selected_columns, undefined),
      sourceInfo: fromJson(row.source_info, undefined),
      targetInfo: fromJson(row.target_info, undefined),
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined
    };
  }

  // --- Append-only job log ---

  public async appendTransferLog(jobId: string, log: TransferLog): Promise<TransferLog> {
    const rows = await this.query(
      `INSERT INTO transfer_logs (job_id, timestamp, level, message, emoji, details)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [jobId, log.timestamp, log.level, log.message, log.emoji || null, toJson(log.details)]
    );

    return { ...log, seq: rows[0].id };
  }

  /** `afterSeq` lets a client fetch only what it has not seen yet. */
  public async getTransferLogs(jobId: string, afterSeq = 0, limit = 1000): Promise<TransferLog[]> {
    const rows = await this.query(
      `SELECT id, timestamp, level, message, emoji, details
       FROM transfer_logs
       WHERE job_id = $1 AND id > $2
       ORDER BY id ASC
       LIMIT $3`,
      [jobId, afterSeq, limit]
    );

    return rows.map(row => ({
      seq: row.id,
      timestamp: row.timestamp,
      level: row.level,
      message: row.message,
      emoji: row.emoji || '',
      details: fromJson(row.details, undefined)
    }));
  }

  public async countTransferLogs(jobId: string): Promise<number> {
    const rows = await this.query(
      `SELECT COUNT(*)::int AS n FROM transfer_logs WHERE job_id = $1`,
      [jobId]
    );
    return rows[0].n;
  }

  // --- Per-row / per-image audit ledger ---

  public async recordRowResults(jobId: string, results: RowResultRecord[]): Promise<void> {
    if (results.length === 0) return;

    const columns = 6;
    const values = results
      .map((_, i) => {
        const base = i * columns;
        return `($1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
      })
      .join(', ');

    const params: any[] = [jobId];
    for (const row of results) {
      params.push(
        row.tabName,
        row.sourceRowNumber,
        row.targetRowId ?? null,
        row.targetRowNumber ?? null,
        row.status,
        row.error ?? null
      );
    }

    await this.query(
      `INSERT INTO transfer_row_results
         (job_id, tab_name, source_row_number, target_row_id, target_row_number, status, error)
       VALUES ${values}`,
      params
    );
  }

  public async recordImageResults(jobId: string, results: ImageResultRecord[]): Promise<void> {
    if (results.length === 0) return;

    const columns = 8;
    const values = results
      .map((_, i) => {
        const base = i * columns;
        return `($1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
      })
      .join(', ');

    const params: any[] = [jobId];
    for (const row of results) {
      params.push(
        row.tabName,
        row.sourceRowNumber,
        row.sourceColumn ?? null,
        row.targetRowId ?? null,
        row.targetColumnId ?? null,
        row.imageUrl ?? null,
        row.status,
        row.error ?? null
      );
    }

    await this.query(
      `INSERT INTO transfer_image_results
         (job_id, tab_name, source_row_number, source_column, target_row_id,
          target_column_id, image_url, status, error)
       VALUES ${values}`,
      params
    );
  }

  public async getRowResults(
    jobId: string,
    options: { status?: string; limit?: number; offset?: number } = {}
  ): Promise<RowResultRecord[]> {
    const { status, limit = 500, offset = 0 } = options;
    const params: any[] = [jobId];
    let where = 'job_id = $1';

    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }

    params.push(limit, offset);
    const rows = await this.query(
      `SELECT * FROM transfer_row_results
       WHERE ${where}
       ORDER BY tab_name ASC, source_row_number ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return rows.map(row => ({
      tabName: row.tab_name,
      sourceRowNumber: row.source_row_number,
      targetRowId: row.target_row_id ?? undefined,
      targetRowNumber: row.target_row_number ?? undefined,
      status: row.status,
      error: row.error ?? undefined
    }));
  }

  public async getImageResults(
    jobId: string,
    options: { status?: string; limit?: number; offset?: number } = {}
  ): Promise<ImageResultRecord[]> {
    const { status, limit = 500, offset = 0 } = options;
    const params: any[] = [jobId];
    let where = 'image.job_id = $1';

    if (status) {
      params.push(status);
      where += ` AND image.status = $${params.length}`;
    }

    params.push(limit, offset);
    const rows = await this.query(
      `SELECT image.*,
              (
                SELECT row_result.target_row_number
                FROM transfer_row_results AS row_result
                WHERE row_result.job_id = image.job_id
                  AND row_result.tab_name = image.tab_name
                  AND row_result.source_row_number = image.source_row_number
                ORDER BY
                  (row_result.target_row_id = image.target_row_id) DESC NULLS LAST,
                  row_result.id DESC
                LIMIT 1
              ) AS target_row_number
       FROM transfer_image_results AS image
       WHERE ${where}
       ORDER BY image.tab_name ASC, image.source_row_number ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return rows.map(row => ({
      tabName: row.tab_name,
      sourceRowNumber: row.source_row_number,
      sourceColumn: row.source_column ?? undefined,
      targetRowId: row.target_row_id ?? undefined,
      targetRowNumber: row.target_row_number ?? undefined,
      targetColumnId: row.target_column_id ?? undefined,
      imageUrl: row.image_url ?? undefined,
      status: row.status,
      error: row.error ?? undefined
    }));
  }

  /** Counts by status — the authoritative numbers behind the UI summary. */
  public async getLedgerSummary(jobId: string): Promise<LedgerSummary> {
    const tally = async (table: string): Promise<Record<string, number>> => {
      const rows = await this.query(
        `SELECT status, COUNT(*)::int AS n FROM ${table} WHERE job_id = $1 GROUP BY status`,
        [jobId]
      );
      return rows.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {} as Record<string, number>);
    };

    const [rows, images] = await Promise.all([
      tally('transfer_row_results'),
      tally('transfer_image_results')
    ]);

    return { rows, images };
  }

  // --- Cancellation ---

  public async requestCancel(jobId: string): Promise<void> {
    await this.query(`UPDATE transfer_jobs SET cancel_requested = TRUE WHERE id = $1`, [jobId]);
  }

  public async isCancelRequested(jobId: string): Promise<boolean> {
    const rows = await this.query(
      `SELECT cancel_requested FROM transfer_jobs WHERE id = $1`,
      [jobId]
    );
    return Boolean(rows[0]?.cancel_requested);
  }

  // --- Image cache ---

  public async cacheImage(hash: string, smartsheetImageId: string, url: string): Promise<void> {
    await this.query(
      `INSERT INTO image_cache (hash, smartsheet_image_id, url)
       VALUES ($1, $2, $3)
       ON CONFLICT (hash) DO UPDATE
         SET smartsheet_image_id = EXCLUDED.smartsheet_image_id, url = EXCLUDED.url`,
      [hash, smartsheetImageId, url]
    );
  }

  public async getCachedImage(hash: string): Promise<ImageCache | null> {
    const rows = await this.query(`SELECT * FROM image_cache WHERE hash = $1`, [hash]);
    if (rows.length === 0) return null;

    return {
      hash: rows[0].hash,
      smartsheetImageId: rows[0].smartsheet_image_id,
      url: rows[0].url,
      createdAt: rows[0].created_at
    };
  }

  // --- Session persistence (backing store for express-session) ---

  public async sessionGet(sid: string): Promise<string | null> {
    const rows = await this.query(
      `SELECT data, expires_at FROM sessions WHERE sid = $1`,
      [sid]
    );
    if (rows.length === 0) return null;

    if (Number(rows[0].expires_at) <= Date.now()) {
      await this.sessionDestroy(sid);
      return null;
    }

    return typeof rows[0].data === 'string' ? rows[0].data : JSON.stringify(rows[0].data);
  }

  public async sessionSet(sid: string, data: string, expiresAt: number): Promise<void> {
    await this.query(
      `INSERT INTO sessions (sid, data, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE
         SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [sid, data, expiresAt]
    );
  }

  public async sessionTouch(sid: string, expiresAt: number): Promise<void> {
    await this.query(`UPDATE sessions SET expires_at = $1 WHERE sid = $2`, [expiresAt, sid]);
  }

  public async sessionDestroy(sid: string): Promise<void> {
    await this.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
  }

  public async sessionCleanup(): Promise<void> {
    await this.query(`DELETE FROM sessions WHERE expires_at <= $1`, [Date.now()]);
  }

  // --- OAuth states ---

  public async createOAuthState(state: Omit<OAuthState, 'createdAt'>): Promise<void> {
    await this.query(
      `INSERT INTO oauth_states (state, provider, user_id, code_verifier)
       VALUES ($1, $2, $3, $4)`,
      [state.state, state.provider, state.userId || null, state.codeVerifier || null]
    );
  }

  public async getOAuthState(state: string): Promise<OAuthState | null> {
    const rows = await this.query(`SELECT * FROM oauth_states WHERE state = $1`, [state]);
    if (rows.length === 0) return null;

    return {
      state: rows[0].state,
      provider: rows[0].provider,
      userId: rows[0].user_id ?? undefined,
      codeVerifier: rows[0].code_verifier,
      createdAt: rows[0].created_at
    };
  }

  public async deleteOAuthState(state: string): Promise<void> {
    await this.query(`DELETE FROM oauth_states WHERE state = $1`, [state]);
  }

  public async cleanupExpiredOAuthStates(): Promise<void> {
    await this.query(`DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '1 hour'`);
  }

  /**
   * A process restart cannot safely resume a Smartsheet insert: the previous
   * process may have sent rows without receiving the response, and replaying
   * them could create duplicates. Persist a clear terminal outcome instead.
   */
  public async failStaleRunningJobs(staleAfterMinutes: number): Promise<string[]> {
    if (!Number.isFinite(staleAfterMinutes) || staleAfterMinutes <= 0) return [];

    const message =
      'Transfer interrupted because the server restarted or stopped reporting progress. ' +
      'It was not retried automatically to avoid duplicate Smartsheet rows.';

    const rows = await this.query<{ id: string }>(
      `UPDATE transfer_jobs
       SET status = 'failed',
           completed_at = NOW(),
           heartbeat_at = NOW(),
           progress = jsonb_set(
             COALESCE(progress, '{}'::jsonb),
             '{errors}',
             COALESCE(progress->'errors', '[]'::jsonb) ||
               jsonb_build_array(jsonb_build_object(
                 'type', 'general_error',
                 'message', $2::text
               )),
             true
           )
       WHERE status = 'running'
         AND heartbeat_at < NOW() - ($1 * INTERVAL '1 minute')
       RETURNING id`,
      [staleAfterMinutes, message]
    );

    for (const row of rows) {
      await this.query(
        `INSERT INTO transfer_logs (job_id, timestamp, level, message, emoji)
         VALUES ($1, NOW(), 'error', $2, NULL)`,
        [row.id, message]
      );
    }

    return rows.map(row => row.id);
  }

  public async cleanupTransferHistory(retentionDays: number): Promise<number> {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;

    const rows = await this.query<{ id: string }>(
      `DELETE FROM transfer_jobs
       WHERE status = ANY($1::text[])
         AND completed_at < NOW() - ($2 * INTERVAL '1 day')
       RETURNING id`,
      [TERMINAL_STATUSES, retentionDays]
    );
    return rows.length;
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

export const database = new PostgresDatabaseManager();

export async function initializeDatabase(): Promise<void> {
  await database.initialize();
  await startDatabaseMaintenance(database, {
    staleTransferMinutes: config.database.staleTransferMinutes,
    transferHistoryRetentionDays: config.database.transferHistoryRetentionDays
  });
}

export default database;
