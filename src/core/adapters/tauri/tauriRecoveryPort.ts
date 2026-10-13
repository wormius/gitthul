import type { RecoveryCleanupResult, RecoverySnapshot } from '@core/domain/recovery';
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
  };
}
