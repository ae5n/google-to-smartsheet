import { startDatabaseMaintenance, DatabaseMaintenanceTarget } from '../maintenance';

describe('database maintenance', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs cleanup at startup and reconciles only once after the deploy grace period', async () => {
    const target: jest.Mocked<DatabaseMaintenanceTarget> = {
      failStaleRunningJobs: jest.fn().mockResolvedValue([]),
      cleanupExpiredOAuthStates: jest.fn().mockResolvedValue(undefined),
      sessionCleanup: jest.fn().mockResolvedValue(undefined),
      cleanupTransferHistory: jest.fn().mockResolvedValue(0)
    };

    const stop = await startDatabaseMaintenance(target, {
      staleTransferMinutes: 15,
      transferHistoryRetentionDays: 30
    });

    expect(target.failStaleRunningJobs).toHaveBeenCalledTimes(1);
    expect(target.cleanupExpiredOAuthStates).toHaveBeenCalledTimes(1);
    expect(target.sessionCleanup).toHaveBeenCalledTimes(1);
    expect(target.cleanupTransferHistory).toHaveBeenCalledWith(30);

    await jest.advanceTimersByTimeAsync(15 * 60 * 1000 + 5_000);
    expect(target.failStaleRunningJobs).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(target.failStaleRunningJobs).toHaveBeenCalledTimes(2);

    stop();
  });

  it('does not schedule reconciliation when stale detection is disabled', async () => {
    const target: jest.Mocked<DatabaseMaintenanceTarget> = {
      failStaleRunningJobs: jest.fn().mockResolvedValue([]),
      cleanupExpiredOAuthStates: jest.fn().mockResolvedValue(undefined),
      sessionCleanup: jest.fn().mockResolvedValue(undefined),
      cleanupTransferHistory: jest.fn().mockResolvedValue(0)
    };

    await startDatabaseMaintenance(target, {
      staleTransferMinutes: 0,
      transferHistoryRetentionDays: 0
    });

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(target.failStaleRunningJobs).toHaveBeenCalledTimes(1);
  });
});
