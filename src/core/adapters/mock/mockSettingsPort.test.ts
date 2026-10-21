import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@core/domain/settings';

import { createMockSettingsPort } from './mockSettingsPort';
import { createMockBackupPort } from './mockBackupPort';
import { memoryStorage } from './storage';

describe('createMockSettingsPort', () => {
  const backedSettings = () => {
    const snapshot = {
      directory: '/mock/backups',
      totalBytes: 3 * 1048576,
      maxBytes: 10 * 1048576,
      enabled: true,
      scanning: false,
      corruptPoints: 0,
      repositories: [
        {
          id: 'repo',
          name: 'fixture',
          repository: '/fixture',
          status: 'completed' as const,
          lastCompletedAt: 2,
          points: [
            { id: 'old', createdAt: 1, bytes: 2 * 1048576, fileCount: 1 },
            { id: 'latest', createdAt: 2, bytes: 1048576, fileCount: 1 },
          ],
        },
      ],
    };
    const backup = createMockBackupPort(snapshot);
    const storage = memoryStorage(
      JSON.stringify({ ...DEFAULT_SETTINGS, backup: { enabled: true, maxMiB: 10 } }),
    );
    return { backup, storage, snapshot };
  };

  it('persists and applies exactly the approved backup plan through shared mock state', async () => {
    const { backup, storage } = backedSettings();
    const settings = createMockSettingsPort({ storage, writeBackupPolicy: backup.writePolicy });
    const plan = await backup.previewLimit(2);
    await settings.patch({ backup: { maxMiB: 2 } }, { backupLimitToken: plan.token });
    expect((await settings.read()).backup.maxMiB).toBe(2);
    expect(JSON.parse(storage.read()!)).toMatchObject({ backup: { maxMiB: 2 } });
    expect(await backup.read()).toMatchObject({ totalBytes: 1048576, maxBytes: 2 * 1048576 });
    expect((await backup.read()).repositories[0]!.points.map((point) => point.id)).toEqual([
      'latest',
    ]);
  });

  it('does not invalidate a reviewed plan when unrelated settings or identical policy are saved', async () => {
    const { backup, storage } = backedSettings();
    const settings = createMockSettingsPort({ storage, writeBackupPolicy: backup.writePolicy });
    const plan = await backup.previewLimit(2);
    await settings.patch({ appearance: { theme: 'abismo' } });
    await backup.writePolicy({ enabled: true, maxMiB: 10 }, undefined, () => undefined);
    expect(await backup.previewLimit(2)).toEqual(plan);
    await settings.patch({ backup: { maxMiB: 2 } }, { backupLimitToken: plan.token });
    expect(await settings.read()).toMatchObject({
      appearance: { theme: 'abismo' },
      backup: { maxMiB: 2 },
    });
    expect((await backup.read()).repositories[0]!.points.map((point) => point.id)).toEqual([
      'latest',
    ]);
  });

  it('rejects an unapproved reduction and rebases queued ordinary settings on the confirmed limit', async () => {
    const { backup, storage, snapshot } = backedSettings();
    const settings = createMockSettingsPort({ storage, writeBackupPolicy: backup.writePolicy });
    const rejected = expect(settings.patch({ backup: { maxMiB: 2 } })).rejects.toMatchObject({
      code: 'backup.limitChanged',
    });
    const next = settings.patch({ locale: 'de' });
    await rejected;
    await next;
    expect(await settings.read()).toMatchObject({ locale: 'de', backup: { maxMiB: 10 } });
    expect(await backup.read()).toEqual(snapshot);
  });

  it('keeps settings and backups intact when persistence fails before approved removal', async () => {
    const { backup, storage, snapshot } = backedSettings();
    const write = vi.fn(() => {
      throw new Error('storage unavailable');
    });
    const settings = createMockSettingsPort({
      storage: { ...storage, write },
      writeBackupPolicy: backup.writePolicy,
    });
    const before = await settings.read();
    const plan = await backup.previewLimit(2);
    await expect(
      settings.patch({ backup: { maxMiB: 2 } }, { backupLimitToken: plan.token }),
    ).rejects.toThrow('storage unavailable');
    expect(await settings.read()).toEqual(before);
    expect(await backup.read()).toEqual(snapshot);
  });

  it('guarda recuperación y la descubre al reiniciar con ajustes antiguos', async () => {
    const storage = memoryStorage(
      JSON.stringify({ locale: 'de', appearance: { theme: 'abismo' } }),
    );
    const first = createMockSettingsPort({ storage });
    expect((await first.read()).recovery).toEqual(DEFAULT_SETTINGS.recovery);
    await first.patch({ recovery: { autoCleanup: false, maxMiB: 256 } });
    const second = createMockSettingsPort({ storage });
    expect((await second.read()).recovery).toEqual({
      ...DEFAULT_SETTINGS.recovery,
      autoCleanup: false,
      maxMiB: 256,
    });
    expect((await second.read()).locale).toBe('de');
  });
  it('arranca con los ajustes de fábrica cuando no hay nada guardado', async () => {
    const port = createMockSettingsPort();

    expect(await port.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('lo que se escribe sobrevive a volver a leer', async () => {
    const storage = memoryStorage();

    const first = createMockSettingsPort({ storage });

    await first.patch({
      appearance: { theme: 'grimorio', themeVariant: 'minimalist' },
      locale: 'fr',
    });
    await first.patch({ panes: { 'working.left': 0.32 } });

    // Un puerto nuevo sobre el mismo almacén es lo que pasa al reiniciar.
    const second = createMockSettingsPort({ storage });
    const settings = await second.read();

    expect(settings.appearance.theme).toBe('grimorio');
    expect(settings.appearance.themeVariant).toBe('minimalist');
    expect(settings.appearance.density).toBe(DEFAULT_SETTINGS.appearance.density);
    expect(settings.locale).toBe('fr');
    expect(settings.panes['working.left']).toBe(0.32);
  });

  it('un archivo corrupto no impide arrancar', async () => {
    const port = createMockSettingsPort({ storage: memoryStorage('{esto no es json') });

    expect(await port.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('valida lo que encuentra en vez de creérselo', async () => {
    const stored = JSON.stringify({ appearance: { theme: 'inventado' }, locale: 'de' });
    const port = createMockSettingsPort({ storage: memoryStorage(stored) });
    const settings = await port.read();

    expect(settings.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme);
    expect(settings.locale).toBe('de');
  });
});
