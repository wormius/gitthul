import type { BackupRestoreResult, BackupSnapshot } from '@core/domain/backup';
import type { BackupPort } from '@core/ports/BackupPort';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call(command, args);
}

export function createTauriBackupPort(call: Invoke = invoke): BackupPort {
  return {
    read: async () => {
      const snapshot = (await call('backup_read')) as BackupSnapshot;
      return { ...snapshot, corruptPoints: snapshot.corruptPoints ?? 0 };
    },
    schedule: async (repository) => {
      await call('backup_schedule', { repository });
    },
    restore: async (id) => (await call('backup_restore', { id })) as BackupRestoreResult | null,
  };
}
