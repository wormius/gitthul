import type { AuthChallenge, AuthPort } from '@core/ports/AuthPort';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}
export function createTauriAuthPort(): AuthPort {
  return {
    subscribe: async (listener) => {
      const { listen } = await import('@tauri-apps/api/event');
      const stop = await listen<AuthChallenge | { dismiss: string }>('gitthul:auth', (event) =>
        listener(event.payload),
      );
      const stopError = await listen('gitthul:auth-storage-error', () =>
        listener({ storageError: true }),
      );
      return () => {
        stop();
        stopError();
      };
    },
    answer: (id, answer) => call('auth_answer', { id, answer }),
    listKeys: () => call('auth_list_keys'),
    importKey: (alias, path) => call('auth_import_key', { alias, path }),
    generateKey: (alias, passphrase) => call('auth_generate_key', { alias, passphrase }),
    removeKey: (id) => call('auth_remove_key', { id }),
    readAccess: (repository, url) => call('auth_read_access', { repository, url }),
    saveAccess: (repository, access, secret) =>
      call('auth_save_access', { repository, access, secret: secret ?? null }),
    forgetAccess: (repository, url) => call('auth_forget_access', { repository, url }),
  };
}
