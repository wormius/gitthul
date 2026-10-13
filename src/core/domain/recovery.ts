/** Respaldo persistente de un estado del repositorio; no contiene los archivos en la respuesta. */
export interface RecoveryPoint {
  id: string;
  repository: string;
  /** Milisegundos Unix. */
  createdAt: number;
  label: string;
  status: 'pending' | 'completed' | 'legacy';
  fileCount: number;
  bytes: number;
  /** El historial de undo/redo o una vista previa todavía necesita este punto. */
  active: boolean;
}

export interface RecoverySnapshot {
  directory: string;
  checkpoints: readonly RecoveryPoint[];
  totalBytes: number;
  overBudget?: boolean;
  protectedCount?: number;
  uncertainBuckets?: number;
  /** La configuración no era válida; el backend suspende la depuración automática. */
  configurationWarning?: boolean;
}

export interface RecoveryCleanupResult {
  removed: number;
  freedBytes: number;
}

export type RecoveryErrorCode =
  | 'recovery.stale'
  | 'recovery.invalid'
  | 'recovery.protected'
  | 'recovery.unavailable'
  | 'recovery.cancelled';

export class RecoveryOperationError extends Error {
  override readonly name = 'RecoveryOperationError';
  readonly params: Readonly<Record<string, string | number>> = {};
  constructor(
    readonly code: RecoveryErrorCode,
    readonly output?: string,
  ) {
    super(code);
  }
}

export function recoveryFailure(value: unknown): { code?: RecoveryErrorCode; output?: string } {
  if (value && typeof value === 'object' && 'code' in value) {
    const code = value.code;
    if (
      typeof code === 'string' &&
      [
        'recovery.stale',
        'recovery.invalid',
        'recovery.protected',
        'recovery.unavailable',
        'recovery.cancelled',
      ].includes(code)
    ) {
      const output =
        'output' in value && typeof value.output === 'string' ? value.output : undefined;
      return { code: code as RecoveryErrorCode, ...(output ? { output } : {}) };
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
