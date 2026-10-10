import { normalizeSession, type SessionSnapshot } from '@core/domain/session';
import type { SessionPort } from '@core/ports/SessionPort';

import { browserStorage, memoryStorage, parseJson, type JsonStorage } from './storage';

export const SESSION_KEY = 'gitthul.session';

export function localSessionStorage(): JsonStorage {
  return browserStorage(SESSION_KEY);
}

export function createMockSessionPort(options: { storage?: JsonStorage } = {}): SessionPort {
  const storage = options.storage ?? memoryStorage();
  let current: SessionSnapshot | null = null;

  return {
    read: () => Promise.resolve((current ??= normalizeSession(parseJson(storage.read())))),
    write: (snapshot) => {
      current = normalizeSession(snapshot);
      storage.write(JSON.stringify(current));
      return Promise.resolve();
    },
    flush: () => Promise.resolve(),
  };
}
