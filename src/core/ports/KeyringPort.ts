import type { CredentialRef } from '@core/domain/credentials';

/**
 * El gestor de llaves del sistema operativo.
 *
 * Los secretos no pasan por los ajustes ni salen del backend una vez
 * guardados. La ventana solo puede consultar si existe una referencia,
 * sustituir su valor o borrarla.
 *
 * Tauri usa Secret Service en Linux, Keychain en macOS y Credential Manager
 * en Windows. El adaptador falso sigue existiendo para navegador y pruebas.
 */
export interface KeyringPort {
  /**
   * Si hay gestor de llaves disponible. En Linux puede no haberlo, y entonces
   * la interfaz tiene que decirlo en vez de tragarse los secretos en silencio.
   */
  isAvailable: () => Promise<boolean>;
  has: (ref: CredentialRef) => Promise<boolean>;
  set: (ref: CredentialRef, secret: string) => Promise<void>;
  delete: (ref: CredentialRef) => Promise<void>;
}
