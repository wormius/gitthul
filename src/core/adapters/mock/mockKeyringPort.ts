import { credentialKey, type CredentialRef } from '@core/domain/credentials';
import type { KeyringPort } from '@core/ports/KeyringPort';

export interface MockKeyringPort extends KeyringPort {
  /** Qué hay guardado ahora mismo. Solo para las pruebas. */
  readonly entries: ReadonlyMap<string, string>;
}

export interface MockKeyringPortOptions {
  /** Para poder desarrollar también la pantalla de «no hay gestor de llaves». */
  available?: boolean;
}

/**
 * Gestor de llaves de mentira, en memoria y sin persistir nada.
 *
 * Que no escriba en ningún lado es la característica, no una limitación: un
 * secreto de desarrollo que sobreviviera al cierre de la ventana sería un
 * secreto de verdad tirado en el disco.
 */
export function createMockKeyringPort(options: MockKeyringPortOptions = {}): MockKeyringPort {
  const entries = new Map<string, string>();
  const available = options.available ?? true;

  return {
    entries,

    isAvailable: () => Promise.resolve(available),

    has: (ref: CredentialRef) => Promise.resolve(entries.has(credentialKey(ref))),

    set: (ref, secret) => {
      entries.set(credentialKey(ref), secret);

      return Promise.resolve();
    },

    delete: (ref) => {
      entries.delete(credentialKey(ref));

      return Promise.resolve();
    },
  };
}
