import type {
  RecoveryCleanupResult,
  RecoveryPreview,
  RecoverySnapshot,
} from '@core/domain/recovery';
import type { RecoveryPort } from '@core/ports/RecoveryPort';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call(command, args);
}

export function createTauriRecoveryPort(call: Invoke = invoke): RecoveryPort {
  return {
    read: async () => (await call('recovery_read')) as RecoverySnapshot,
    cleanup: async () => (await call('recovery_cleanup')) as RecoveryCleanupResult,
    importLegacy: async () => (await call('recovery_import_legacy')) as number,
    remove: async (id) => {
      await call('recovery_remove', { id });
    },
    preview: async (id) => (await call('recovery_preview', { id })) as RecoveryPreview,
    restore: async (token) => {
      await call('recovery_restore', { token });
    },
    cancelPreview: async (token) => {
      await call('recovery_cancel_preview', { token });
    },
    export: async (id) => (await call('recovery_export', { id })) as boolean,
    openDirectory: async () => {
      await call('recovery_open_directory');
    },
  };
}
