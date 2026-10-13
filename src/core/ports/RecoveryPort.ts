import type { RecoveryCleanupResult, RecoverySnapshot } from '@core/domain/recovery';

export interface RecoveryPort {
  read: () => Promise<RecoverySnapshot>;
  /** Limpia caché inactivo; conserva puntos activos, pendientes o ambiguos. */
  cleanup: () => Promise<RecoveryCleanupResult>;
}
