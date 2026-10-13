import type { BackupRestoreResult, BackupSnapshot } from '@core/domain/backup';

export interface BackupPort {
  read: () => Promise<BackupSnapshot>;
  /** Encola una revisión; el respaldo nunca bloquea la apertura del repositorio. */
  schedule: (repository: string) => Promise<void>;
  /** Elige una carpeta nueva; null representa cancelar sin modificar archivos. */
  restore: (id: string) => Promise<BackupRestoreResult | null>;
}
