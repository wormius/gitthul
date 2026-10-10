import { normalizeSession, type SessionSnapshot } from '@core/domain/session';
import type { SessionPort } from '@core/ports/SessionPort';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

export function createTauriSessionPort(): SessionPort {
  let tail = Promise.resolve();

  return {
    read: async () => normalizeSession(await invoke<unknown>('session_read')),
    write: (snapshot: SessionSnapshot) => {
      const next = normalizeSession(snapshot);
      // Un fallo previo se informa a quien hizo esa escritura, pero no envenena la cola futura.
      tail = tail
        .catch(() => undefined)
        .then(() => invoke<void>('session_write', { session: next }));
      return tail;
    },
    flush: () => tail,
  };
}
