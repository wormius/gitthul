import {
  mergeSettings,
  normalizeSettings,
  type Settings,
  type SettingsPatch,
} from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';
import type { MockBackupPort } from './mockBackupPort';

import { browserStorage, memoryStorage, parseJson, type JsonStorage } from './storage';

export const SETTINGS_KEY = 'gitthul.settings';

export function localSettingsStorage(): JsonStorage {
  return browserStorage(SETTINGS_KEY);
}

export interface MockSettingsPortOptions {
  storage?: JsonStorage;
  writeBackupPolicy?: MockBackupPort['writePolicy'];
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
  let writes: Promise<void> = Promise.resolve();

  const load = (): Settings => (current ??= normalizeSettings(parseJson(storage.read())));

  return {
    read: () => Promise.resolve(load()),

    patch: (patch: SettingsPatch, writeOptions) => {
      const change = structuredClone(patch);
      const token = writeOptions?.backupLimitToken;
      const write = writes
        .catch(() => undefined)
        .then(async () => {
          const previous = load();
          const next = mergeSettings(previous, change);
          const persist = () => storage.write(JSON.stringify(next));
          if (
            options.writeBackupPolicy &&
            (token !== undefined ||
              next.backup.maxMiB !== previous.backup.maxMiB ||
              next.backup.enabled !== previous.backup.enabled)
          ) {
            await options.writeBackupPolicy(next.backup, token, persist);
          } else {
            persist();
          }
          current = next;
        });
      writes = write;
      return write;
    },

    flush: () => writes,
  };
}
