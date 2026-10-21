import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@core/domain/settings';
import { createMockAppPorts } from './createMockAppPorts';
import * as mockBackup from './mockBackupPort';
import { SETTINGS_KEY } from './mockSettingsPort';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it('wires the reviewed backup plan through configured settings without losing its approval', async () => {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...DEFAULT_SETTINGS,
      backup: { enabled: false, maxMiB: 10 },
    }),
  );
  const backup = mockBackup.createMockBackupPort({
    directory: '/mock/backups',
    totalBytes: 3 * 1048576,
    maxBytes: 10 * 1048576,
    enabled: false,
    scanning: false,
    corruptPoints: 0,
    repositories: [
      {
        id: 'repo',
        name: 'fixture',
        repository: '/fixture',
        status: 'completed',
        lastCompletedAt: 2,
        points: [
          { id: 'old', createdAt: 1, bytes: 2 * 1048576, fileCount: 1 },
          { id: 'latest', createdAt: 2, bytes: 1048576, fileCount: 1 },
        ],
      },
    ],
  });
  vi.spyOn(mockBackup, 'createMockBackupPort').mockReturnValue(backup);
  const ports = createMockAppPorts();
  const plan = await ports.backup.previewLimit(2);
  await ports.settings.patch({ backup: { maxMiB: 2 } }, { backupLimitToken: plan.token });
  expect((await ports.settings.read()).backup).toEqual({ enabled: false, maxMiB: 2 });
  expect(await ports.backup.read()).toMatchObject({ totalBytes: 1048576, maxBytes: 2 * 1048576 });
  expect((await backup.read()).repositories[0]!.points.map((point) => point.id)).toEqual([
    'latest',
  ]);
});

it('initializes mock catalog preferences from the saved settings', async () => {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ backup: { enabled: false, maxMiB: 42 } }),
  );
  const ports = createMockAppPorts();
  expect(await ports.backup.read()).toMatchObject({ enabled: false, maxBytes: 42 * 1048576 });
});
