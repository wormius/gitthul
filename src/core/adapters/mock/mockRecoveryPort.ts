import { RecoveryOperationError, type RecoverySnapshot } from '@core/domain/recovery';
import type { RecoveryPort } from '@core/ports/RecoveryPort';

/** El navegador de desarrollo no lee ni restaura repositorios reales. */
export function createMockRecoveryPort(initial?: RecoverySnapshot): RecoveryPort {
  let snapshot: RecoverySnapshot = initial ?? {
    directory: '/mock/gitthul/recovery',
    checkpoints: [],
    totalBytes: 0,
    overBudget: false,
    protectedCount: 0,
  };
  let sequence = 0;
  const previews = new Map<string, string>();
  const point = (id: string) => {
    const found = snapshot.checkpoints.find((candidate) => candidate.id === id);
    if (!found) throw new RecoveryOperationError('recovery.stale');
    return found;
  };
  return {
    read: () => Promise.resolve(structuredClone(snapshot)),
    cleanup: () => Promise.resolve({ removed: 0, freedBytes: 0 }),
    importLegacy: () => Promise.resolve(0),
    remove: (id) =>
      Promise.resolve().then(() => {
        const found = point(id);
        if (found.active || [...previews.values()].includes(id))
          throw new RecoveryOperationError('recovery.protected');
        snapshot = {
          ...snapshot,
          checkpoints: snapshot.checkpoints.filter((candidate) => candidate.id !== id),
          totalBytes: Math.max(0, snapshot.totalBytes - found.bytes),
        };
      }),
    preview: (id) => {
      const found = point(id);
      const token = `mock-recovery-${++sequence}`;
      previews.set(token, id);
      return Promise.resolve({
        token,
        repository: found.repository,
        fileCount: found.fileCount,
        paths: [],
        includesGitState: found.status !== 'legacy',
      });
    },
    restore: (token) => {
      const id = previews.get(token);
      if (!id) return Promise.reject(new RecoveryOperationError('recovery.stale'));
      point(id);
      previews.delete(token);
      snapshot = {
        ...snapshot,
        checkpoints: snapshot.checkpoints.map((candidate) =>
          candidate.id === id ? { ...candidate, status: 'completed' } : candidate,
        ),
      };
      return Promise.resolve();
    },
    cancelPreview: (token) => {
      previews.delete(token);
      return Promise.resolve();
    },
    export: (id) => {
      point(id);
      return Promise.resolve(true);
    },
    openDirectory: () => Promise.resolve(),
  };
}
