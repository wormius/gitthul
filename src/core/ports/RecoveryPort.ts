import type {
  RecoveryCleanupResult,
  RecoveryPreview,
  RecoverySnapshot,
} from '@core/domain/recovery';

export interface RecoveryPort {
  read: () => Promise<RecoverySnapshot>;
  /** Aplica los límites configurados, conservando puntos activos o pendientes. */
  cleanup: () => Promise<RecoveryCleanupResult>;
  /** Importación explícita desde un repositorio elegido, sin borrar sus copias. */
  importLegacy: () => Promise<number>;
  /** Elimina solo la copia elegida, si el historial activo no la necesita. */
  remove: (id: string) => Promise<void>;
  preview: (id: string) => Promise<RecoveryPreview>;
  /** Revalida el token y respalda el estado actual antes de restaurar. */
  restore: (token: string) => Promise<void>;
  cancelPreview: (token: string) => Promise<void>;
  /** Exporta los archivos a una carpeta elegida. false significa cancelación. */
  export: (id: string) => Promise<boolean>;
  openDirectory: () => Promise<void>;
}
