import type { BackupLimitPlan, BackupRestoreResult, BackupSnapshot } from '@core/domain/backup';
import type { BackupPort } from '@core/ports/BackupPort';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call(command, args);
}

function normalizeSnapshot(value: unknown): BackupSnapshot {
  const snapshot = value as BackupSnapshot;
  return {
    ...snapshot,
    corruptPoints: snapshot.corruptPoints ?? 0,
    scanning: snapshot.scanning ?? false,
  };
}

export function createTauriBackupPort(call: Invoke = invoke): BackupPort {
  return {
    read: async () => normalizeSnapshot(await call('backup_read')),
    previewLimit: async (maxMiB) =>
      (await call('backup_preview_limit', { maxMiB })) as BackupLimitPlan,
    delete: async (id) => normalizeSnapshot(await call('backup_delete', { id })),
    prune: async () => normalizeSnapshot(await call('backup_prune')),
    schedule: async (repository) => {
      await call('backup_schedule', { repository });
    },
    restore: async (id) => (await call('backup_restore', { id })) as BackupRestoreResult | null,
  };
}
