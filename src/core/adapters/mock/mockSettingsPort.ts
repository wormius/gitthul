import {
  mergeSettings,
  normalizeSettings,
  type Settings,
  type SettingsPatch,
} from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';

import { browserStorage, memoryStorage, parseJson, type JsonStorage } from './storage';

export const SETTINGS_KEY = 'gitthul.settings';

export function localSettingsStorage(): JsonStorage {
  return browserStorage(SETTINGS_KEY);
}

export interface MockSettingsPortOptions {
  storage?: JsonStorage;
}

/**
 * Ajustes falsos, con la misma semántica que los de verdad.
 *
 * Lee entero, valida lo que encuentre y escribe por parches. Que el guardado
 * sea síncrono aquí no cambia el contrato: quien llama sigue sin poder suponer
 * cuándo llegó al disco.
 */
export function createMockSettingsPort(options: MockSettingsPortOptions = {}): SettingsPort {
  const storage = options.storage ?? memoryStorage();

  let current: Settings | null = null;

  const load = (): Settings => (current ??= normalizeSettings(parseJson(storage.read())));

  return {
    read: () => Promise.resolve(load()),

    patch: (patch: SettingsPatch) => {
      const next = mergeSettings(load(), patch);
      storage.write(JSON.stringify(next));
      current = next;

      return Promise.resolve();
    },

    flush: () => Promise.resolve(),
  };
}
