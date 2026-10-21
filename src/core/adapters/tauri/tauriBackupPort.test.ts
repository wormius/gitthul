import { expect, it, vi } from 'vitest';
import { createTauriBackupPort } from './tauriBackupPort';

it('previews an exact limit through the native command without writing settings', async () => {
  const plan = {
    maxMiB: 100,
    currentBytes: 200,
    projectedBytes: 80,
    minimumBytes: 50,
    deleteCount: 2,
    feasible: true,
    token: 'native-plan',
  };
  const call = vi.fn().mockResolvedValue(plan);
  expect(await createTauriBackupPort(call).previewLimit(100)).toEqual(plan);
  expect(call).toHaveBeenCalledExactlyOnceWith('backup_preview_limit', { maxMiB: 100 });
});

it('preserves native limit-preview failures and automatic-prune metadata', async () => {
  const error = JSON.stringify({ code: 'backup.limitChanged' });
  const lastAutoPrune = { id: 'event-1', removedCount: 3, freedBytes: 123 };
  const call = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({ lastAutoPrune });
  const port = createTauriBackupPort(call);
  await expect(port.previewLimit(10)).rejects.toBe(error);
  expect((await port.read()).lastAutoPrune).toEqual(lastAutoPrune);
});

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

it('deletes only through backup_delete and returns the updated native catalog', async () => {
  const snapshot = {
    directory: '/native/backups',
    totalBytes: 450,
    maxBytes: 1024,
    enabled: true,
    scanning: false,
    corruptPoints: 0,
    repositories: [],
  };
  const call = vi.fn().mockResolvedValue(snapshot);
  const port = createTauriBackupPort(call);
  expect(await port.delete('older-point')).toEqual(snapshot);
  expect(call).toHaveBeenCalledExactlyOnceWith('backup_delete', { id: 'older-point' });
});

it.each(['backup.protected', 'backup.stale', 'backup.invalid'])(
  'preserves deletion errors: %s',
  async (code) => {
    const error = new Error(JSON.stringify({ code, output: 'Deletion declined' }));
    const call = vi.fn().mockRejectedValue(error);
    const port = createTauriBackupPort(call);
    await expect(port.delete('point')).rejects.toBe(error);
    expect(call).toHaveBeenCalledExactlyOnceWith('backup_delete', { id: 'point' });
  },
);

it('normalizes the corruption count on deletion results just as on reads', async () => {
  const call = vi.fn().mockResolvedValueOnce({ corruptPoints: 2 }).mockResolvedValue({});
  const port = createTauriBackupPort(call);
  expect((await port.delete('first')).corruptPoints).toBe(2);
  expect((await port.delete('second')).corruptPoints).toBe(0);
});

it('prunes through backup_prune without arguments and returns the updated native catalog', async () => {
  const snapshot = {
    directory: '/native/backups',
    totalBytes: 450,
    maxBytes: 1024,
    enabled: true,
    scanning: false,
    corruptPoints: 0,
    repositories: [],
  };
  const call = vi.fn().mockResolvedValue(snapshot);
  const port = createTauriBackupPort(call);
  expect(await port.prune()).toEqual(snapshot);
  expect(call).toHaveBeenCalledExactlyOnceWith('backup_prune');
});

it.each(['backup.invalid', 'backup.unavailable'])('preserves pruning errors: %s', async (code) => {
  const error = new Error(JSON.stringify({ code, output: 'Pruning declined' }));
  const call = vi.fn().mockRejectedValue(error);
  const port = createTauriBackupPort(call);
  await expect(port.prune()).rejects.toBe(error);
  expect(call).toHaveBeenCalledExactlyOnceWith('backup_prune');
});

it.each(['read', 'delete', 'prune'] as const)(
  'preserves scanning state and normalizes legacy %s snapshots',
  async (method) => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({ scanning: true, corruptPoints: 2 })
      .mockResolvedValueOnce({ scanning: false, corruptPoints: 0 })
      .mockResolvedValue({});
    const port = createTauriBackupPort(call);
    const read = () => (method === 'delete' ? port.delete('point') : port[method]());
    expect(await read()).toMatchObject({ scanning: true, corruptPoints: 2 });
    expect(await read()).toMatchObject({ scanning: false, corruptPoints: 0 });
    expect(await read()).toMatchObject({ scanning: false, corruptPoints: 0 });
  },
);
