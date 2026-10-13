import { BackupOperationError, type BackupSnapshot } from '@core/domain/backup';
import type { BackupPort } from '@core/ports/BackupPort';

/** No lee, archiva ni restaura carpetas reales en el navegador. */
export function createMockBackupPort(initial?: BackupSnapshot): BackupPort {
  const snapshot: BackupSnapshot = initial ?? {
    directory: '/mock/gitthul/backups',
    totalBytes: 0,
    maxBytes: 1073741824,
    enabled: true,
    corruptPoints: 0,
    repositories: [],
  };
  return {
    read: () => Promise.resolve(structuredClone(snapshot)),
    schedule: () => Promise.resolve(),
    restore: (id) => {
      const repository = snapshot.repositories.find((candidate) =>
        candidate.points.some((point) => point.id === id),
      );
      if (!repository) return Promise.reject(new BackupOperationError('backup.stale'));
      return Promise.resolve({ path: `/mock/restored/${repository.name}` });
    },
  };
}
