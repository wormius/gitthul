import type { RecoverySnapshot } from '@core/domain/recovery';
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
  return {
    read: () => Promise.resolve(structuredClone(snapshot)),
    cleanup: () => {
      const removed = snapshot.checkpoints.filter(
        (candidate) => candidate.status === 'completed' && !candidate.active,
      );
      const ids = new Set(removed.map((candidate) => candidate.id));
      const freedBytes = removed.reduce((total, candidate) => total + candidate.bytes, 0);
      snapshot = {
        ...snapshot,
        checkpoints: snapshot.checkpoints.filter((candidate) => !ids.has(candidate.id)),
        totalBytes: Math.max(0, snapshot.totalBytes - freedBytes),
      };
      return Promise.resolve({ removed: removed.length, freedBytes });
    },
  };
}
