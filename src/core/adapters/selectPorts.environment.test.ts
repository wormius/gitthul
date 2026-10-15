import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const factories = vi.hoisted(() => ({
  native: vi.fn(() => ({ environment: 'native' })),
  simulated: vi.fn(() => ({ environment: 'simulated' })),
}));

vi.mock('./tauri/createTauriAppPorts', () => ({ createTauriAppPorts: factories.native }));
vi.mock('./mock/createMockAppPorts', () => ({ createMockAppPorts: factories.simulated }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('adapter environment selection', () => {
  it.each(['production', 'mock', 'test'])(
    'requires the desktop runtime in a production %s build',
    async (mode) => {
      vi.stubEnv('DEV', false);
      vi.stubEnv('MODE', mode);
      vi.stubEnv('VITE_GITTHUL_MOCK', '1');
      const { selectPorts, NativeRuntimeUnavailableError } = await import('./selectPorts');
      expect(selectPorts).toThrow(NativeRuntimeUnavailableError);
      expect(factories.simulated).not.toHaveBeenCalled();
      expect(factories.native).not.toHaveBeenCalled();
    },
  );

  it('requires explicit simulation in browser development', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_GITTHUL_MOCK', '');
    const { selectPorts, NativeRuntimeUnavailableError } = await import('./selectPorts');
    expect(selectPorts).toThrow(NativeRuntimeUnavailableError);
    expect(factories.simulated).not.toHaveBeenCalled();
  });

  it.each(['mock', 'test'])(
    'keeps synchronous simulated factories in development %s mode',
    async (mode) => {
      vi.stubEnv('DEV', true);
      vi.stubEnv('MODE', mode);
      const { selectPorts } = await import('./selectPorts');
      expect(selectPorts()).toEqual({ environment: 'simulated' });
      expect(factories.simulated).toHaveBeenCalledOnce();
    },
  );

  it('gives the native runtime priority over explicit simulation', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('MODE', 'mock');
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    const { selectPorts } = await import('./selectPorts');
    expect(selectPorts()).toEqual({ environment: 'native' });
    expect(factories.native).toHaveBeenCalledOnce();
    expect(factories.simulated).not.toHaveBeenCalled();
  });

  it('preserves native initialization failures without switching to simulation', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('MODE', 'mock');
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    const failure = new Error('native initialization failed');
    factories.native.mockImplementationOnce(() => {
      throw failure;
    });
    const { selectPorts } = await import('./selectPorts');
    expect(selectPorts).toThrow(failure);
    expect(factories.simulated).not.toHaveBeenCalled();
  });
});
