import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@core/domain/settings';

import { createTauriSettingsPort } from './tauriSettingsPort';

describe('createTauriSettingsPort', () => {
  it('migra un canal beta heredado y persiste solo la preferencia de consulta al iniciar', async () => {
    let disk: unknown = { updates: { channel: 'beta', checkOnStartup: true } };
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'settings_read') return Promise.resolve(structuredClone(disk));
      disk = structuredClone(args?.['settings']);
      return Promise.resolve(undefined);
    });
    const port = createTauriSettingsPort(call);
    expect((await port.read()).updates).toEqual({ checkOnStartup: true });
    await port.patch({ updates: { checkOnStartup: false } });
    expect(disk).toMatchObject({ updates: { checkOnStartup: false } });
    expect((disk as { updates: unknown }).updates).not.toHaveProperty('channel');
    expect((await createTauriSettingsPort(call).read()).updates).toEqual({ checkOnStartup: false });
  });

  it('una lectura fallida deja ajustes editables con depuración suspendida hasta activarla explícitamente', async () => {
    let disk: unknown = null;
    const written: unknown[] = [];
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'settings_read')
        return disk === null
          ? Promise.reject(new Error('settings.json is not valid JSON'))
          : Promise.resolve(structuredClone(disk));
      disk = structuredClone(args?.['settings']);
      written.push(disk);
      return Promise.resolve(undefined);
    });
    const port = createTauriSettingsPort(call);
    expect(await port.read()).toEqual({
      ...DEFAULT_SETTINGS,
      recovery: { ...DEFAULT_SETTINGS.recovery, autoCleanup: false },
    });
    expect((await port.read()).recovery.autoCleanup).toBe(false);
    expect(call).toHaveBeenCalledOnce();
    await port.patch({ appearance: { theme: 'abismo' } });
    expect(written[0]).toMatchObject({
      appearance: { theme: 'abismo' },
      recovery: { autoCleanup: false },
    });
    await port.patch({ recovery: { autoCleanup: true } });
    expect(written[1]).toMatchObject({
      recovery: { autoCleanup: true, maxCheckpoints: 100, maxAgeDays: 30, maxMiB: 1024 },
    });
    expect((await createTauriSettingsPort(call).read()).recovery.autoCleanup).toBe(true);
  });

  it('una escritura sin permisos falla explícitamente y conserva la política suspendida', async () => {
    const call = vi.fn((_command: string) => Promise.reject(new Error('Permission denied')));
    const port = createTauriSettingsPort(call);
    expect((await port.read()).recovery.autoCleanup).toBe(false);
    await expect(port.patch({ recovery: { autoCleanup: true } })).rejects.toThrow(
      'Permission denied',
    );
    expect((await port.read()).recovery.autoCleanup).toBe(false);
    expect(call.mock.calls.filter(([command]) => command === 'settings_read')).toHaveLength(1);
  });
  it('migra ajustes sin variante y escribe la selección para el siguiente arranque', async () => {
    let disk: unknown = { appearance: { theme: 'grimorio', mode: 'light' } };
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'settings_read') return Promise.resolve(structuredClone(disk));
      disk = structuredClone(args?.['settings']);
      return Promise.resolve(undefined);
    });
    const port = createTauriSettingsPort(call);

    expect((await port.read()).appearance).toMatchObject({
      theme: 'grimorio',
      themeVariant: 'classic',
      mode: 'light',
    });

    await port.patch({ appearance: { themeVariant: 'dense' } });
    const reopened = createTauriSettingsPort(call);

    expect((await reopened.read()).appearance).toMatchObject({
      theme: 'grimorio',
      themeVariant: 'dense',
      mode: 'light',
    });
  });

  it('serializa escrituras completas para que un parche anterior no gane la carrera', async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const written: unknown[] = [];
    const call = vi.fn(async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
      if (command === 'settings_read') return structuredClone(DEFAULT_SETTINGS) as T;
      written.push(args?.['settings']);
      if (written.length === 1) await firstWrite;
      return undefined as T;
    });
    const port = createTauriSettingsPort(call);
    await port.read();

    const rename = port.patch({ workingWipNames: { repo: 'Entrega' } });
    const resize = port.patch({ panes: { history: 480 } });

    await vi.waitFor(() => expect(written).toHaveLength(1));
    releaseFirst();
    await Promise.all([rename, resize]);

    expect(written).toHaveLength(2);
    expect(written[1]).toMatchObject({
      workingWipNames: { repo: 'Entrega' },
      panes: { history: 480 },
    });
  });
});
