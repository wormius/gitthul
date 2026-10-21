import type { BackupLimitPlan, BackupRestoreResult, BackupSnapshot } from '@core/domain/backup';

export interface BackupPort {
  read: () => Promise<BackupSnapshot>;
  previewLimit: (maxMiB: number) => Promise<BackupLimitPlan>;
  /** Encola una revisión; el respaldo nunca bloquea la apertura del repositorio. */
  schedule: (repository: string) => Promise<void>;
  /** Elige una carpeta nueva; null representa cancelar sin modificar archivos. */
  restore: (id: string) => Promise<BackupRestoreResult | null>;
  /** Deletes an older point; the native store revalidates protection and returns its current catalog. */
  delete: (id: string) => Promise<BackupSnapshot>;
  /** Deletes all older points, preserving every latest timestamp tie per repository. */
  prune: () => Promise<BackupSnapshot>;
}
