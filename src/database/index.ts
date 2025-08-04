import fs from 'fs';
import path from 'path';
import config from '../config';
import { User, TransferJob, ImageCache, OAuthState } from '../types';

interface DatabaseData {
  users: User[];
  transferJobs: TransferJob[];
  imageCache: ImageCache[];
  oauthStates: OAuthState[];
}

class DatabaseManager {
  private dbPath: string;
  private data: DatabaseData;

  constructor() {
    this.dbPath = path.resolve(config.database.path.replace('.db', '.json'));
    const dbDir = path.dirname(this.dbPath);
    
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.data = {
      users: [],
      transferJobs: [],
      imageCache: [],
      oauthStates: []
    };
  }

  public async initialize(): Promise<void> {
    try {
      if (fs.existsSync(this.dbPath)) {
        const fileData = fs.readFileSync(this.dbPath, 'utf8');
        this.data = JSON.parse(fileData);
      } else {
        await this.save();
      }
    } catch (error) {
      console.error('Error initializing database:', error);
      // Use default empty data if file is corrupted
      this.data = {
        users: [],
        transferJobs: [],
        imageCache: [],
        oauthStates: []
      };
      await this.save();
    }
  }

  private async save(): Promise<void> {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error saving database:', error);
    }
  }

  // User operations
  public async createUser(user: Omit<User, 'createdAt' | 'updatedAt'>): Promise<User> {
    const newUser: User = {
      ...user,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.data.users.push(newUser);
    await this.save();
    
    return newUser;
  }

  public async getUserById(id: string): Promise<User | null> {
    return this.data.users.find(user => user.id === id) || null;
  }

  public async getUserByEmail(email: string): Promise<User | null> {
    return this.data.users.find(user => user.email === email) || null;
  }

  public async updateUserTokens(userId: string, provider: 'google' | 'smartsheet', tokens: any): Promise<void> {
    const user = this.data.users.find(u => u.id === userId);
    if (user) {
      if (provider === 'google') {
        user.googleTokens = tokens;
      } else {
        user.smartsheetTokens = tokens;
      }
      user.updatedAt = new Date();
      await this.save();
    }
  }

  // Transfer job operations
  public async createTransferJob(job: Omit<TransferJob, 'createdAt' | 'completedAt'>): Promise<TransferJob> {
    const newJob: TransferJob = {
      ...job,
      createdAt: new Date()
    };
    
    this.data.transferJobs.push(newJob);
    await this.save();
    
    return newJob;
  }

  public async getTransferJobById(id: string): Promise<TransferJob | null> {
    return this.data.transferJobs.find(job => job.id === id) || null;
  }

  public async updateTransferJobStatus(id: string, status: TransferJob['status'], progress?: TransferJob['progress']): Promise<void> {
    const job = this.data.transferJobs.find(j => j.id === id);
    if (job) {
      job.status = status;
      if (progress) {
        job.progress = progress;
      }
      if (['completed', 'failed', 'cancelled'].includes(status)) {
        job.completedAt = new Date();
      }
      await this.save();
    }
  }

  public async getUserTransferJobs(userId: string, limit: number = 50): Promise<TransferJob[]> {
    return this.data.transferJobs
      .filter(job => job.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  // Image cache operations
  public async cacheImage(hash: string, smartsheetImageId: string, url: string): Promise<void> {
    // Remove existing entry with same hash
    this.data.imageCache = this.data.imageCache.filter(img => img.hash !== hash);
    
    // Add new entry
    this.data.imageCache.push({
      hash,
      smartsheetImageId,
      url,
      createdAt: new Date()
    });
    
    await this.save();
  }

  public async getCachedImage(hash: string): Promise<ImageCache | null> {
    return this.data.imageCache.find(img => img.hash === hash) || null;
  }

  // OAuth state operations
  public async createOAuthState(state: Omit<OAuthState, 'createdAt'>): Promise<void> {
    this.data.oauthStates.push({
      ...state,
      createdAt: new Date()
    });
    
    await this.save();
  }

  public async getOAuthState(state: string): Promise<OAuthState | null> {
    return this.data.oauthStates.find(s => s.state === state) || null;
  }

  public async deleteOAuthState(state: string): Promise<void> {
    this.data.oauthStates = this.data.oauthStates.filter(s => s.state !== state);
    await this.save();
  }

  public async cleanupExpiredOAuthStates(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    this.data.oauthStates = this.data.oauthStates.filter(
      s => new Date(s.createdAt) > oneHourAgo
    );
    
    await this.save();
  }

  public close(): void {
    // JSON database doesn't need explicit closing
  }
}

export const database = new DatabaseManager();

export async function initializeDatabase(): Promise<void> {
  await database.initialize();
  
  // Cleanup expired OAuth states every 30 minutes
  setInterval(() => {
    database.cleanupExpiredOAuthStates().catch(console.error);
  }, 30 * 60 * 1000);
}

export default database;