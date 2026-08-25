export interface DatabaseMaintenanceTarget {
  failStaleRunningJobs(staleAfterMinutes: number): Promise<string[]>;
  cleanupExpiredOAuthStates(): Promise<void>;
  sessionCleanup(): Promise<void>;
  cleanupTransferHistory(retentionDays: number): Promise<number>;
}

interface DatabaseMaintenanceOptions {
  staleTransferMinutes: number;
  transferHistoryRetentionDays: number;
}

/**
 * Runs maintenance without turning an always-on web process into a database
 * keepalive. A second, one-shot reconciliation covers jobs orphaned while a
 * zero-downtime deploy is draining the previous Render instance.
 */
export async function startDatabaseMaintenance(
  target: DatabaseMaintenanceTarget,
  options: DatabaseMaintenanceOptions
): Promise<() => void> {
  const reconcileInterrupted = async (): Promise<void> => {
    const ids = await target.failStaleRunningJobs(options.staleTransferMinutes);
    if (ids.length > 0) {
      console.warn(JSON.stringify({ event: 'stale_transfers_failed', jobIds: ids }));
    }
  };

  const runCleanup = async (): Promise<void> => {
    await target.cleanupExpiredOAuthStates();
    await target.sessionCleanup();

    const count = await target.cleanupTransferHistory(options.transferHistoryRetentionDays);
    if (count > 0) {
      console.log(JSON.stringify({ event: 'transfer_history_pruned', count }));
    }
  };

  await reconcileInterrupted();
  await runCleanup();

  if (options.staleTransferMinutes <= 0) {
    return () => undefined;
  }

  const delayMs = options.staleTransferMinutes * 60 * 1000 + 5_000;
  const delayedReconciliation = setTimeout(() => {
    reconcileInterrupted().catch(console.error);
  }, delayMs);
  delayedReconciliation.unref?.();

  return () => clearTimeout(delayedReconciliation);
}
