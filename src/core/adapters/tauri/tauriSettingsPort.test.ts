import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@core/domain/settings';
import { backupFailure } from '@core/domain/backup';

import { createTauriSettingsPort } from './tauriSettingsPort';

describe('createTauriSettingsPort', () => {
  it('forwards a backup limit token only with its exact write', async () => {
    const call = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    const port = createTauriSettingsPort(vi.fn(), call);
    await port.patch({ backup: { maxMiB: 512 } }, { backupLimitToken: 'reviewed-plan' });
    await port.patch({ locale: 'de' });
    expect(call.mock.calls.filter(([command]) => command === 'settings_write')).toEqual([
      [
        'settings_write',
        {
          settings: { ...DEFAULT_SETTINGS, backup: { ...DEFAULT_SETTINGS.backup, maxMiB: 512 } },
          backupLimitToken: 'reviewed-plan',
        },
      ],
      [
        'settings_write',
        {
          settings: {
            ...DEFAULT_SETTINGS,
            locale: 'de',
            backup: { ...DEFAULT_SETTINGS.backup, maxMiB: 512 },
          },
        },
      ],
    ]);
  });

  it('rebases queued changes on confirmed settings after a rejected limit instead of resubmitting it', async () => {
    let rejectLimit!: (reason: unknown) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectLimit = reject;
    });
    const written: Record<string, unknown>[] = [];
    const failure = JSON.stringify({ code: 'backup.limitChanged' });
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'settings_read') return Promise.resolve(DEFAULT_SETTINGS);
      written.push(args!);
      return written.length === 1 ? pending : Promise.resolve();
    });
    const port = createTauriSettingsPort(vi.fn(), call);
    await port.read();
    const limit = port.patch({ backup: { maxMiB: 100 } }, { backupLimitToken: 'old-plan' });
    const rejected = expect(limit).rejects.toBe(failure);
    const locale = port.patch({ locale: 'fr' });
    const panes = port.patch({ panes: { history: 420 } });
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect((await port.read()).backup.maxMiB).toBe(DEFAULT_SETTINGS.backup.maxMiB);
    rejectLimit(failure);
    await rejected;
    await Promise.all([locale, panes]);
    expect(backupFailure(failure)).toEqual({ code: 'backup.limitChanged' });
    expect(written.slice(1)).toEqual([
      { settings: { ...DEFAULT_SETTINGS, locale: 'fr' } },
      {
        settings: {
          ...DEFAULT_SETTINGS,
          locale: 'fr',
          panes: { ...DEFAULT_SETTINGS.panes, history: 420 },
        },
      },
    ]);
    expect(await port.read()).toMatchObject({
      locale: 'fr',
      backup: DEFAULT_SETTINGS.backup,
      panes: { history: 420 },
    });
    await port.flush();
  });

  it('migra un canal beta heredado y conserva las preferencias de consulta y recordatorio', async () => {
    let disk: unknown = { updates: { channel: 'beta', checkOnStartup: true } };
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'settings_read') return Promise.resolve(structuredClone(disk));
      disk = structuredClone(args?.['settings']);
      return Promise.resolve(undefined);
    });
    const port = createTauriSettingsPort(vi.fn(), call);
    expect((await port.read()).updates).toEqual({
      ...DEFAULT_SETTINGS.updates,
      checkOnStartup: true,
    });
    await port.patch({ updates: { checkOnStartup: false } });
    expect(disk).toMatchObject({ updates: { checkOnStartup: false } });
    expect((disk as { updates: unknown }).updates).not.toHaveProperty('channel');
    expect((await createTauriSettingsPort(vi.fn(), call).read()).updates).toEqual(
      DEFAULT_SETTINGS.updates,
    );
  });

  it('conserva un aplazamiento de una semana y la supresión al volver a abrir los ajustes', async () => {
    let disk: unknown = DEFAULT_SETTINGS;
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'settings_read') return Promise.resolve(structuredClone(disk));
      disk = structuredClone(args?.['settings']);
      return Promise.resolve(undefined);
    });
    const port = createTauriSettingsPort(vi.fn(), call);
    await port.read();
    const nextPromptAt = Date.UTC(2026, 9, 20);
    await port.patch({ updates: { nextPromptAt } });
    expect((await createTauriSettingsPort(vi.fn(), call).read()).updates).toEqual({
      ...DEFAULT_SETTINGS.updates,
      nextPromptAt,
    });
    await port.patch({ updates: { promptDismissed: true, nextPromptAt: 0 } });
    expect((await createTauriSettingsPort(vi.fn(), call).read()).updates).toEqual({
      ...DEFAULT_SETTINGS.updates,
      promptDismissed: true,
    });
  });

  it('una lectura fallida deja ajustes editables con depuración suspendida hasta activarla explícitamente', async () => {
    let disk: unknown = null;
    const written: unknown[] = [];
    const originalError = new Error('settings.json is not valid JSON');
    const onReadError = vi.fn();
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'settings_read')
        return disk === null
          ? Promise.reject(originalError)
          : Promise.resolve(structuredClone(disk));
      disk = structuredClone(args?.['settings']);
      written.push(disk);
      return Promise.resolve(undefined);
    });
    const port = createTauriSettingsPort(onReadError, call);
    expect(await port.read()).toEqual({
      ...DEFAULT_SETTINGS,
      recovery: { ...DEFAULT_SETTINGS.recovery, autoCleanup: false },
      backup: { ...DEFAULT_SETTINGS.backup, enabled: false },
    });
    expect((await port.read()).recovery.autoCleanup).toBe(false);
    expect(call).toHaveBeenCalledOnce();
    expect(onReadError).toHaveBeenCalledExactlyOnceWith(originalError);
    await port.patch({ appearance: { theme: 'abismo' } });
    expect(written[0]).toMatchObject({
      appearance: { theme: 'abismo' },
      recovery: { autoCleanup: false },
      backup: { enabled: false },
    });
    await port.patch({ recovery: { autoCleanup: true } });
    expect(written[1]).toMatchObject({
      recovery: { autoCleanup: true, maxCheckpoints: 100, maxAgeDays: 30, maxMiB: 1024 },
    });
    expect((await createTauriSettingsPort(vi.fn(), call).read()).recovery.autoCleanup).toBe(true);
  });

  it('una escritura sin permisos falla explícitamente y conserva la política suspendida', async () => {
    const call = vi.fn((_command: string) => Promise.reject(new Error('Permission denied')));
    const port = createTauriSettingsPort(vi.fn(), call);
    expect((await port.read()).recovery.autoCleanup).toBe(false);
    await expect(port.patch({ recovery: { autoCleanup: true } })).rejects.toThrow(
      'Permission denied',
    );
    expect((await port.read()).recovery.autoCleanup).toBe(false);
    expect(call.mock.calls.filter(([command]) => command === 'settings_read')).toHaveLength(1);
  });

  it('informa el error original del puente sin simular persistencia ni activar tareas automáticas', async () => {
    const originalError = { command: 'settings_read', reason: 'native bridge unavailable' };
    // Tauri can reject with a serialized native value rather than an Error instance.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const call = vi.fn(() => Promise.reject(originalError));
    const onReadError = vi.fn();
    const port = createTauriSettingsPort(onReadError, call);

    const settings = await port.read();
    expect(settings.recovery.autoCleanup).toBe(false);
    expect(settings.backup.enabled).toBe(false);
    expect(onReadError).toHaveBeenCalledExactlyOnceWith(originalError);
    expect(await port.read()).toBe(settings);
    expect(call.mock.calls).toEqual([['settings_read']]);

    await expect(port.patch({ locale: 'fr' })).rejects.toBe(originalError);
    expect(await port.read()).toBe(settings);
    expect(onReadError).toHaveBeenCalledOnce();
  });

  it('migra ajustes sin variante y escribe la selección para el siguiente arranque', async () => {
    let disk: unknown = { appearance: { theme: 'grimorio', mode: 'light' } };
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'settings_read') return Promise.resolve(structuredClone(disk));
      disk = structuredClone(args?.['settings']);
      return Promise.resolve(undefined);
    });
    const port = createTauriSettingsPort(vi.fn(), call);

    expect((await port.read()).appearance).toMatchObject({
      theme: 'grimorio',
      themeVariant: 'classic',
      mode: 'light',
    });

    await port.patch({ appearance: { themeVariant: 'dense' } });
    const reopened = createTauriSettingsPort(vi.fn(), call);

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
    const port = createTauriSettingsPort(vi.fn(), call);
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
