import { expect, it, vi } from 'vitest';
import { createTauriBackupPort } from './tauriBackupPort';

it('read, scheduling and restoration use the native backup commands without file access in React', async () => {
  const call = vi.fn((_command: string, _args?: Record<string, unknown>) =>
    Promise.resolve(_command === 'backup_read' ? { corruptPoints: 0 } : null),
  );
  const port = createTauriBackupPort(call);
  await port.read();
  await port.schedule('/repos/example');
  expect(await port.restore('completed-backup')).toBeNull();
  expect(call.mock.calls).toEqual([
    ['backup_read'],
    ['backup_schedule', { repository: '/repos/example' }],
    ['backup_restore', { id: 'completed-backup' }],
  ]);
});

it('reads damaged point counts and defaults older native catalogs to zero', async () => {
  const call = vi.fn().mockResolvedValueOnce({ corruptPoints: 3 }).mockResolvedValue({});
  const port = createTauriBackupPort(call);
  expect((await port.read()).corruptPoints).toBe(3);
  expect((await port.read()).corruptPoints).toBe(0);
});

it('restoration errors are preserved instead of becoming selector cancellation', async () => {
  const error = new Error(
    JSON.stringify({ code: 'backup.destination', output: 'Destination already exists' }),
  );
  const port = createTauriBackupPort(() => Promise.reject(error));
  await expect(port.restore('point')).rejects.toEqual(error);
});
