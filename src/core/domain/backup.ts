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
  /** Puntos dañados excluidos del catálogo restaurable; la depuración queda suspendida. */
  corruptPoints: number;
  repositories: readonly BackupRepository[];
}

export interface BackupRestoreResult {
  path: string;
}

export type BackupErrorCode =
  'backup.invalid' | 'backup.unavailable' | 'backup.destination' | 'backup.stale';

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
  if (value instanceof Error && value.message.startsWith('{')) {
    try {
      return backupFailure(JSON.parse(value.message));
    } catch {
      // Keep the original error when the native output is not structured JSON.
    }
  }
  if (value && typeof value === 'object' && 'code' in value) {
    const code = value.code;
    if (
      typeof code === 'string' &&
      ['backup.invalid', 'backup.unavailable', 'backup.destination', 'backup.stale'].includes(code)
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
