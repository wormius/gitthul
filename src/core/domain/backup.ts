/** Un punto completo y verificado; las capturas parciales nunca se publican aquí. */
export interface BackupPoint {
  id: string;
  createdAt: number;
  bytes: number;
  fileCount: number;
}

export type BackupStatus =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'unchanged'
  | 'tooSoon'
  | 'busy'
  | 'overBudget'
  | 'failed'
  | 'disabled';

export interface BackupRepository {
  id: string;
  name: string;
  repository: string;
  status: BackupStatus;
  reason?: 'changed' | 'incomplete' | 'io' | 'git' | 'corrupt';
  lastCompletedAt: number | null;
  points: readonly BackupPoint[];
}

export interface BackupSnapshot {
  directory: string;
  totalBytes: number;
  maxBytes: number;
  enabled: boolean;
  /** Revisión nativa en curso; las acciones sobre puntos conocidos esperan y revalidan en el almacén. */
  scanning: boolean;
  /** Puntos dañados excluidos del catálogo restaurable; la depuración queda suspendida. */
  corruptPoints: number;
  lastAutoPrune?: { id: string; removedCount: number; freedBytes: number };
  repositories: readonly BackupRepository[];
}

/** Preview of the exact space change, revalidated before accepting its token. */
export interface BackupLimitPlan {
  maxMiB: number;
  currentBytes: number;
  projectedBytes: number;
  minimumBytes: number;
  deleteCount: number;
  feasible: boolean;
  token: string;
}

/** The latest published point is protected per repository, including timestamp ties. */
export function isBackupPointProtected(repository: BackupRepository, point: BackupPoint): boolean {
  const latest = repository.points.reduce(
    (at, candidate) => Math.max(at, candidate.createdAt),
    -Infinity,
  );
  return point.createdAt === latest;
}

export interface BackupRestoreResult {
  path: string;
}

export type BackupErrorCode =
  | 'backup.invalid'
  | 'backup.unavailable'
  | 'backup.destination'
  | 'backup.stale'
  | 'backup.protected'
  | 'backup.limitChanged'
  | 'backup.limitTooSmall';

export class BackupOperationError extends Error {
  override readonly name = 'BackupOperationError';
  constructor(
    readonly code: BackupErrorCode,
    readonly output?: string,
  ) {
    super(code);
  }
}

export function backupFailure(value: unknown): { code?: BackupErrorCode; output?: string } {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  if (message.trimStart().startsWith('{')) {
    try {
      return backupFailure(JSON.parse(message));
    } catch {
      // Keep the original error when the native output is not structured JSON.
    }
  }
  if (value && typeof value === 'object' && 'code' in value) {
    const code = value.code;
    if (
      typeof code === 'string' &&
      [
        'backup.invalid',
        'backup.unavailable',
        'backup.destination',
        'backup.stale',
        'backup.protected',
        'backup.limitChanged',
        'backup.limitTooSmall',
      ].includes(code)
    ) {
      const output =
        'output' in value && typeof value.output === 'string' ? value.output : undefined;
      return { code: code as BackupErrorCode, ...(output ? { output } : {}) };
    }
  }
  return {
    output:
      value instanceof Error
        ? value.message
        : typeof value === 'string'
          ? value
          : JSON.stringify(value),
  };
}
