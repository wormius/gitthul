import type { KeyringPort } from '@core/ports/KeyringPort';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

async function tauriInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core');

  return invoke<unknown>(command, args);
}

/**
 * Llavero nativo opaco: ningún comando ofrece recuperar el secreto guardado.
 */
export function createTauriKeyringPort(call: Invoke = tauriInvoke): KeyringPort {
  return {
    isAvailable: async () => (await call('keyring_is_available')) as boolean,
    has: async (credential) => (await call('keyring_has', { credential })) as boolean,
    set: async (credential, secret) => {
      await call('keyring_set', { credential, secret });
    },
    delete: async (credential) => {
      await call('keyring_delete', { credential });
    },
  };
}
