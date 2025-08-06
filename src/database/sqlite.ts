import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from '../config';
import { User, TransferJob, TransferLog, SourceInfo, TargetInfo, ImageCache, OAuthState } from '../types';

interface DatabaseData {
  users: User[];
  transferJobs: TransferJob[];
  imageCache: ImageCache[];
  oauthStates: OAuthState[];
}

class SQLiteDatabaseManager {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    this.dbPath = path.resolve(config.database.path);
    const dbDir = path.dirname(this.dbPath);
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  public async initialize(): Promise<void> {
    try {
      // Create tables if they don't exist
      this.createTables();
      console.log('SQLite database initialized successfully');
    } catch (error) {
      console.error('Error initializing SQLite database:', error);
      throw error;
    }
  }

  private createTables(): void {
    // Users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        avatar TEXT,
        google_tokens TEXT,
        smartsheet_tokens TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Transfer jobs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transfer_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        google_spreadsheet_id TEXT NOT NULL,
        google_sheet_tabs TEXT NOT NULL,
        smartsheet_id INTEGER NOT NULL,
        column_mappings TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        progress TEXT,
        logs TEXT,
        dry_run BOOLEAN DEFAULT FALSE,
        header_row_index INTEGER,
        selected_columns TEXT,
        source_info TEXT,
        target_info TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Image cache table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_cache (
        hash TEXT PRIMARY KEY,
        smartsheet_image_id TEXT NOT NULL,
        url TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // OAuth states table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        user_id TEXT,
        code_verifier TEXT,
        redirect_uri TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
      CREATE INDEX IF NOT EXISTS idx_transfer_jobs_user_id ON transfer_jobs (user_id);
      CREATE INDEX IF NOT EXISTS idx_transfer_jobs_status ON transfer_jobs (status);
      CREATE INDEX IF NOT EXISTS idx_transfer_jobs_created_at ON transfer_jobs (created_at);
      CREATE INDEX IF NOT EXISTS idx_oauth_states_created_at ON oauth_states (created_at);
    `);
  }

  // User operations
  public async createUser(user: Omit<User, 'createdAt' | 'updatedAt'>): Promise<User> {
    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, name, avatar, google_tokens, smartsheet_tokens)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      user.id,
      user.email,
      user.name,
      null, // avatar not in User interface
      user.googleTokens ? JSON.stringify(user.googleTokens) : null,
      user.smartsheetTokens ? JSON.stringify(user.smartsheetTokens) : null
    );

    const newUser: User = {
      ...user,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return newUser;
  }

  public async getUserById(id: string): Promise<User | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE id = ?
    `);
    
    const row = stmt.get(id) as any;
    if (!row) return null;

    return this.parseUserRow(row);
  }

  public async getUserByEmail(email: string): Promise<User | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE email = ?
    `);
    
    const row = stmt.get(email) as any;
    if (!row) return null;

    return this.parseUserRow(row);
  }

  public async updateUserTokens(userId: string, provider: 'google' | 'smartsheet', tokens: any): Promise<void> {
    const column = provider === 'google' ? 'google_tokens' : 'smartsheet_tokens';
    const stmt = this.db.prepare(`
      UPDATE users SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);

    stmt.run(JSON.stringify(tokens), userId);
  }

  private parseUserRow(row: any): User {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      googleTokens: row.google_tokens ? JSON.parse(row.google_tokens) : undefined,
      smartsheetTokens: row.smartsheet_tokens ? JSON.parse(row.smartsheet_tokens) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Transfer job operations
  public async createTransferJob(job: Omit<TransferJob, 'createdAt' | 'completedAt'>): Promise<TransferJob> {
    const stmt = this.db.prepare(`
      INSERT INTO transfer_jobs (
        id, user_id, google_spreadsheet_id, google_sheet_tabs, smartsheet_id,
        column_mappings, status, progress, logs, dry_run, header_row_index, selected_columns
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const params = [
      job.id,
      job.userId,
      job.googleSpreadsheetId,
      JSON.stringify(job.googleSheetTabs),
      job.smartsheetId,
      JSON.stringify(job.columnMappings),
      job.status,
      job.progress ? JSON.stringify(job.progress) : null,
      job.logs ? JSON.stringify(job.logs) : null,
      job.dryRun ? 1 : 0, // Convert boolean to integer
      job.headerRowIndex ?? null,
      job.selectedColumns ? JSON.stringify(job.selectedColumns) : null
    ];

    // Debug: Log parameter types to identify the problematic one
    console.log('SQLite parameters:', params.map((p, i) => `${i}: ${typeof p} = ${p}`));

    stmt.run(...params);

    const newJob: TransferJob = {
      ...job,
      createdAt: new Date()
    };

    return newJob;
  }

  public async getTransferJobById(id: string): Promise<TransferJob | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM transfer_jobs WHERE id = ?
    `);
    
    const row = stmt.get(id) as any;
    if (!row) return null;

    return this.parseTransferJobRow(row);
  }

  public async updateTransferJobStatus(id: string, status: TransferJob['status'], progress?: TransferJob['progress']): Promise<void> {
    let query = 'UPDATE transfer_jobs SET status = ?';
    const params: any[] = [status];

    if (progress) {
      query += ', progress = ?';
      params.push(JSON.stringify(progress));
    }

    if (['completed', 'failed', 'cancelled'].includes(status)) {
      query += ', completed_at = CURRENT_TIMESTAMP';
    }

    query += ' WHERE id = ?';
    params.push(id);

    const stmt = this.db.prepare(query);
    stmt.run(...params);
  }

  public async updateTransferJobLogs(id: string, logs: TransferLog[]): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE transfer_jobs SET logs = ? WHERE id = ?
    `);

    stmt.run(JSON.stringify(logs), id);
  }

  public async updateTransferJobInfo(id: string, sourceInfo?: SourceInfo, targetInfo?: TargetInfo): Promise<void> {
    let query = 'UPDATE transfer_jobs SET';
    const params: any[] = [];
    const updates: string[] = [];

    if (sourceInfo) {
      updates.push(' source_info = ?');
      params.push(JSON.stringify(sourceInfo));
    }

    if (targetInfo) {
      updates.push(' target_info = ?');
      params.push(JSON.stringify(targetInfo));
    }

    if (updates.length === 0) return;

    query += updates.join(',') + ' WHERE id = ?';
    params.push(id);

    const stmt = this.db.prepare(query);
    stmt.run(...params);
  }

  public async getUserTransferJobs(userId: string, limit: number = 50): Promise<TransferJob[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM transfer_jobs 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `);

    const rows = stmt.all(userId, limit) as any[];
    return rows.map(row => this.parseTransferJobRow(row));
  }

  private parseTransferJobRow(row: any): TransferJob {
    return {
      id: row.id,
      userId: row.user_id,
      googleSpreadsheetId: row.google_spreadsheet_id,
      googleSheetTabs: JSON.parse(row.google_sheet_tabs),
      smartsheetId: row.smartsheet_id,
      columnMappings: JSON.parse(row.column_mappings),
      status: row.status,
      progress: row.progress ? JSON.parse(row.progress) : {
        totalRows: 0,
        processedRows: 0,
        totalImages: 0,
        processedImages: 0,
        errors: [],
        warnings: []
      },
      logs: row.logs ? JSON.parse(row.logs) : [],
      dryRun: Boolean(row.dry_run),
      headerRowIndex: row.header_row_index,
      selectedColumns: row.selected_columns ? JSON.parse(row.selected_columns) : undefined,
      sourceInfo: row.source_info ? JSON.parse(row.source_info) : undefined,
      targetInfo: row.target_info ? JSON.parse(row.target_info) : undefined,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined
    };
  }

  // Image cache operations
  public async cacheImage(hash: string, smartsheetImageId: string, url: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO image_cache (hash, smartsheet_image_id, url)
      VALUES (?, ?, ?)
    `);

    stmt.run(hash, smartsheetImageId, url);
  }

  public async getCachedImage(hash: string): Promise<ImageCache | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM image_cache WHERE hash = ?
    `);

    const row = stmt.get(hash) as any;
    if (!row) return null;

    return {
      hash: row.hash,
      smartsheetImageId: row.smartsheet_image_id,
      url: row.url,
      createdAt: new Date(row.created_at)
    };
  }

  // OAuth state operations
  public async createOAuthState(state: Omit<OAuthState, 'createdAt'>): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO oauth_states (state, provider, user_id, code_verifier, redirect_uri)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      state.state,
      state.provider,
      state.userId || null,
      state.codeVerifier || null,
      null // redirectUri not in OAuthState interface
    );
  }

  public async getOAuthState(state: string): Promise<OAuthState | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM oauth_states WHERE state = ?
    `);

    const row = stmt.get(state) as any;
    if (!row) return null;

    return {
      state: row.state,
      provider: row.provider,
      userId: row.user_id,
      codeVerifier: row.code_verifier,
      createdAt: new Date(row.created_at)
    };
  }

  public async deleteOAuthState(state: string): Promise<void> {
    const stmt = this.db.prepare(`
      DELETE FROM oauth_states WHERE state = ?
    `);

    stmt.run(state);
  }

  public async cleanupExpiredOAuthStates(): Promise<void> {
    const stmt = this.db.prepare(`
      DELETE FROM oauth_states WHERE created_at < datetime('now', '-1 hour')
    `);

    stmt.run();
  }

  public close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}

export const database = new SQLiteDatabaseManager();

export async function initializeDatabase(): Promise<void> {
  await database.initialize();
  
  // Cleanup expired OAuth states every 30 minutes
  setInterval(() => {
    database.cleanupExpiredOAuthStates().catch(console.error);
  }, 30 * 60 * 1000);
}

export default database;