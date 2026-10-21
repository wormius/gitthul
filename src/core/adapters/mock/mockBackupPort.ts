import {
  BackupOperationError,
  isBackupPointProtected,
  type BackupLimitPlan,
  type BackupSnapshot,
} from '@core/domain/backup';
import { BACKUP_LIMITS, type BackupSettings } from '@core/domain/settings';
import type { BackupPort } from '@core/ports/BackupPort';

let nextMockStore = 0;

export interface MockBackupPort extends BackupPort {
  /** Internal mock wiring: persist before changing the in-memory backup store. */
  writePolicy: (
    policy: BackupSettings,
    token: string | undefined,
    persist: () => void,
  ) => Promise<void>;
}

/** No lee, archiva ni restaura carpetas reales en el navegador. */
export function createMockBackupPort(initial?: BackupSnapshot): MockBackupPort {
  const storeId = ++nextMockStore;
  let revision = 0;
  let snapshot: BackupSnapshot = structuredClone(
    initial ?? {
      directory: '/mock/gitthul/backups',
      totalBytes: 0,
      maxBytes: 1073741824,
      enabled: true,
      scanning: false,
      corruptPoints: 0,
      repositories: [],
    },
  );
  const mutationError = () =>
    snapshot.corruptPoints > 0
      ? new BackupOperationError('backup.invalid')
      : snapshot.scanning && !snapshot.repositories.some((repository) => repository.points.length)
        ? new BackupOperationError('backup.unavailable')
        : null;
  const validateLimit = (maxMiB: number) => {
    if (!Number.isInteger(maxMiB) || maxMiB < BACKUP_LIMITS.min || maxMiB > BACKUP_LIMITS.max) {
      throw new BackupOperationError('backup.invalid');
    }
  };
  const limitPlan = (maxMiB: number): { plan: BackupLimitPlan; removed: Set<string> } => {
    const error = mutationError();
    if (error) throw error;
    validateLimit(maxMiB);
    // Fixtures model disjoint point bytes; any unassigned usage remains fixed.
    // Native plans instead measure deduplicated chunks, manifests and temporaries.
    const removable = snapshot.repositories
      .flatMap((repository) =>
        repository.points.filter((point) => !isBackupPointProtected(repository, point)),
      )
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const minimumBytes = Math.max(
      0,
      snapshot.totalBytes - removable.reduce((total, point) => total + point.bytes, 0),
    );
    const maxBytes = maxMiB * 1048576;
    const feasible = minimumBytes <= maxBytes;
    const removed = new Set<string>();
    let projectedBytes = snapshot.totalBytes;
    for (const point of removable) {
      if (projectedBytes <= maxBytes) break;
      removed.add(point.id);
      projectedBytes = Math.max(0, projectedBytes - point.bytes);
    }
    return {
      plan: {
        maxMiB,
        currentBytes: snapshot.totalBytes,
        projectedBytes,
        minimumBytes,
        deleteCount: feasible ? removed.size : 0,
        feasible,
        token: `mock-limit-${storeId}-${revision}-${maxMiB}`,
      },
      removed,
    };
  };
  return {
    read: () => Promise.resolve(structuredClone(snapshot)),
    previewLimit: (maxMiB) => Promise.resolve().then(() => structuredClone(limitPlan(maxMiB).plan)),
    writePolicy: (policy, token, persist) =>
      Promise.resolve().then(() => {
        validateLimit(policy.maxMiB);
        const maxBytes = policy.maxMiB * 1048576;
        if (maxBytes >= snapshot.maxBytes) {
          // Equal or larger limits never delete data, including legacy over-budget
          // stores. They must remain editable when a catalog cannot be inspected.
          const changed = snapshot.maxBytes !== maxBytes || snapshot.enabled !== policy.enabled;
          persist();
          snapshot = { ...snapshot, enabled: policy.enabled, maxBytes };
          if (changed) revision += 1;
          return;
        }
        const { plan, removed } = limitPlan(policy.maxMiB);
        if (!plan.feasible) throw new BackupOperationError('backup.limitTooSmall');
        if (
          (token !== undefined && token !== plan.token) ||
          (plan.deleteCount > 0 && token === undefined)
        ) {
          throw new BackupOperationError('backup.limitChanged');
        }
        const next: BackupSnapshot = {
          ...snapshot,
          enabled: policy.enabled,
          maxBytes,
          totalBytes: plan.projectedBytes,
          scanning: false,
          repositories: snapshot.repositories.map((repository) => ({
            ...repository,
            points: repository.points.filter((point) => !removed.has(point.id)),
          })),
        };
        // No asynchronous gap: a failed settings write leaves every point intact.
        persist();
        snapshot = next;
        revision += 1;
      }),
    schedule: () => Promise.resolve(),
    delete: (id) => {
      const error = mutationError();
      if (error) return Promise.reject(error);
      const repository = snapshot.repositories.find((candidate) =>
        candidate.points.some((point) => point.id === id),
      );
      const point = repository?.points.find((candidate) => candidate.id === id);
      if (!repository || !point) return Promise.reject(new BackupOperationError('backup.stale'));
      if (isBackupPointProtected(repository, point)) {
        return Promise.reject(new BackupOperationError('backup.protected'));
      }
      // Mock fixtures model non-overlapping point bytes. Native usage is measured
      // from its deduplicated store after deleting unreferenced chunks.
      snapshot = {
        ...snapshot,
        scanning: false,
        totalBytes: Math.max(0, snapshot.totalBytes - point.bytes),
        repositories: snapshot.repositories.map((candidate) =>
          candidate.id === repository.id
            ? { ...candidate, points: candidate.points.filter((entry) => entry.id !== id) }
            : candidate,
        ),
      };
      revision += 1;
      return Promise.resolve(structuredClone(snapshot));
    },
    prune: () => {
      const error = mutationError();
      if (error) return Promise.reject(error);
      let removedBytes = 0;
      let removedCount = 0;
      const repositories = snapshot.repositories.map((repository) => ({
        ...repository,
        points: repository.points.filter((point) => {
          if (isBackupPointProtected(repository, point)) return true;
          removedBytes += point.bytes;
          removedCount += 1;
          return false;
        }),
      }));
      // Like single deletion, the mock models disjoint point bytes; the native
      // store accounts for shared chunks and measures the resulting disk usage.
      snapshot = {
        ...snapshot,
        scanning: false,
        totalBytes: Math.max(0, snapshot.totalBytes - removedBytes),
        repositories,
      };
      if (removedCount > 0) revision += 1;
      return Promise.resolve(structuredClone(snapshot));
    },
    restore: (id) => {
      const repository = snapshot.repositories.find((candidate) =>
        candidate.points.some((point) => point.id === id),
      );
      if (!repository) return Promise.reject(new BackupOperationError('backup.stale'));
      return Promise.resolve({ path: `/mock/restored/${repository.name}` });
    },
  };
}
