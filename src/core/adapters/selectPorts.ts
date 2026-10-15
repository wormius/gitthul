import type { AppPorts } from './appPorts';
import { createTauriAppPorts } from './tauri/createTauriAppPorts';
import { isTauri } from './tauri/isTauri';

export type { AppPorts } from './appPorts';

// Compile-time guards remove the dynamic import, its fixtures and its adapters
// from every production build, including `vite build --mode mock`.
const mockFactory =
  import.meta.env.DEV &&
  (import.meta.env.MODE === 'test' ||
    import.meta.env.MODE === 'mock' ||
    import.meta.env['VITE_GITTHUL_MOCK'] === '1')
    ? (await import('./mock/createMockAppPorts')).createMockAppPorts
    : undefined;

export class NativeRuntimeUnavailableError extends Error {
  constructor() {
    super(
      'GitThul requires the desktop runtime. Simulation is available only in explicit development mode.',
    );
    this.name = 'NativeRuntimeUnavailableError';
  }
}

/** Native adapters take priority; IPC failures never select a simulator. */
export function selectPorts(): AppPorts {
  if (isTauri()) return createTauriAppPorts();
  if (mockFactory) return mockFactory();
  throw new NativeRuntimeUnavailableError();
}
