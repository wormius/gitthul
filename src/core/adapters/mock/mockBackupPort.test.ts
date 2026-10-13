import { expect, it } from 'vitest';
import { createMockBackupPort } from './mockBackupPort';

it('restores only published complete points and keeps them available independently of repo access', async () => {
  const port = createMockBackupPort({
    directory: '/mock/backups',
    enabled: true,
    corruptPoints: 0,
    totalBytes: 100,
    maxBytes: 1073741824,
    repositories: [
      {
        id: 'repo',
        name: 'example',
        repository: '/deleted/example',
        status: 'failed',
        reason: 'io',
        lastCompletedAt: 1000,
        points: [{ id: 'point', createdAt: 1000, bytes: 100, fileCount: 5 }],
      },
    ],
  });
  expect(await port.restore('point')).toEqual({ path: '/mock/restored/example' });
  await expect(port.restore('partial')).rejects.toMatchObject({ code: 'backup.stale' });
  expect((await port.read()).repositories[0]?.points).toHaveLength(1);
});
