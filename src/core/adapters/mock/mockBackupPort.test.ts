import { describe, expect, it, vi } from 'vitest';
import type { BackupSnapshot } from '@core/domain/backup';
import { createMockBackupPort } from './mockBackupPort';

it('restores only published complete points and keeps them available independently of repo access', async () => {
  const port = createMockBackupPort({
    directory: '/mock/backups',
    enabled: true,
    scanning: false,
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

function snapshot(): BackupSnapshot {
  return {
    directory: '/mock/backups',
    enabled: true,
    scanning: false,
    corruptPoints: 0,
    totalBytes: 1075,
    maxBytes: 1073741824,
    repositories: [
      {
        id: 'a',
        name: 'first',
        repository: '/fixtures/first',
        status: 'failed',
        reason: 'io',
        lastCompletedAt: 30,
        points: [
          { id: 'a-old', createdAt: 10, bytes: 100, fileCount: 2 },
          { id: 'a-middle', createdAt: 20, bytes: 200, fileCount: 3 },
          { id: 'a-latest', createdAt: 30, bytes: 300, fileCount: 4 },
          { id: 'a-latest-tie', createdAt: 30, bytes: 50, fileCount: 1 },
        ],
      },
      {
        id: 'b',
        name: 'second',
        repository: '/fixtures/second',
        status: 'completed',
        lastCompletedAt: 15,
        points: [
          { id: 'b-old', createdAt: 5, bytes: 25, fileCount: 1 },
          { id: 'b-latest', createdAt: 15, bytes: 400, fileCount: 8 },
        ],
      },
    ],
  };
}

describe('deleting mock backup points', () => {
  it('exposes an idle catalog by default and permits deletion during a scan of known points', async () => {
    expect((await createMockBackupPort().read()).scanning).toBe(false);
    const initial = { ...snapshot(), scanning: true };
    const port = createMockBackupPort(initial);
    expect(await port.delete('a-old')).toMatchObject({ scanning: false, totalBytes: 975 });
    expect((await port.read()).scanning).toBe(false);
    expect(initial.scanning).toBe(true);
    expect(initial.repositories[0]!.points).toHaveLength(4);
  });

  it('keeps protected and stale rejections unchanged during a scan of known points', async () => {
    const initial = { ...snapshot(), scanning: true };
    const port = createMockBackupPort(initial);
    await expect(port.delete('a-latest')).rejects.toMatchObject({ code: 'backup.protected' });
    await expect(port.delete('missing')).rejects.toMatchObject({ code: 'backup.stale' });
    expect(await port.read()).toEqual(initial);
  });

  it('deletes older points, updates disjoint-byte usage and preserves all other metadata', async () => {
    const initial = snapshot();
    const original = structuredClone(initial);
    const port = createMockBackupPort(initial);
    const deleted = await port.delete('a-old');
    expect(deleted).toEqual({
      ...original,
      totalBytes: 975,
      repositories: [
        { ...original.repositories[0], points: original.repositories[0]!.points.slice(1) },
        original.repositories[1],
      ],
    });
    expect(await port.read()).toEqual(deleted);
    expect(initial).toEqual(original);
    expect((await port.delete('a-middle')).totalBytes).toBe(775);
    await expect(port.restore('a-old')).rejects.toMatchObject({ code: 'backup.stale' });
    expect(await port.restore('a-latest')).toEqual({ path: '/mock/restored/first' });
    expect(await port.restore('b-old')).toEqual({ path: '/mock/restored/second' });
  });

  it.each(['a-latest', 'a-latest-tie', 'b-latest'])(
    'preserves protected point %s and the complete catalog',
    async (id) => {
      const initial = snapshot();
      const port = createMockBackupPort(initial);
      await expect(port.delete(id)).rejects.toMatchObject({ code: 'backup.protected' });
      expect(await port.read()).toEqual(initial);
    },
  );

  it('rejects missing, already deleted and corrupt-catalog points without changes', async () => {
    const port = createMockBackupPort(snapshot());
    const before = await port.read();
    await expect(port.delete('missing')).rejects.toMatchObject({ code: 'backup.stale' });
    expect(await port.read()).toEqual(before);
    const after = await port.delete('a-old');
    await expect(port.delete('a-old')).rejects.toMatchObject({ code: 'backup.stale' });
    expect(await port.read()).toEqual(after);
    const corrupt = { ...snapshot(), corruptPoints: 1 };
    const damaged = createMockBackupPort(corrupt);
    await expect(damaged.delete('a-old')).rejects.toMatchObject({ code: 'backup.invalid' });
    expect(await damaged.read()).toEqual(corrupt);
  });

  it('owns its initial state and returns deep clones from reads and deletions', async () => {
    const initial = snapshot();
    const original = structuredClone(initial);
    const port = createMockBackupPort(initial);
    initial.repositories[0]!.points[0]!.bytes = 9999;
    initial.repositories[1]!.name = 'changed by caller';
    expect(await port.read()).toEqual(original);
    const reading = await port.read();
    reading.repositories[0]!.points[0]!.createdAt = 9999;
    reading.repositories = [];
    expect(await port.read()).toEqual(original);
    const deleted = await port.delete('a-old');
    expect(deleted.totalBytes).toBe(975);
    const saved = structuredClone(deleted);
    deleted.repositories[0]!.points[0]!.bytes = 9999;
    deleted.repositories[1]!.name = 'changed by caller';
    deleted.totalBytes = 0;
    expect(await port.read()).toEqual(saved);
  });
});

describe('pruning mock backup points', () => {
  it('permits pruning during a scan of known points and returns a completed catalog', async () => {
    const initial = { ...snapshot(), scanning: true };
    const port = createMockBackupPort(initial);
    const pruned = await port.prune();
    expect(pruned).toMatchObject({ scanning: false, totalBytes: 750 });
    expect(
      pruned.repositories.flatMap((repository) => repository.points.map((point) => point.id)),
    ).toEqual(['a-latest', 'a-latest-tie', 'b-latest']);
    expect(await port.read()).toEqual(pruned);
    expect(initial.scanning).toBe(true);
    expect(initial.repositories[0]!.points).toHaveLength(4);
  });

  it('removes every older point while preserving latest ties, other repositories and metadata', async () => {
    const initial = snapshot();
    const original = structuredClone(initial);
    const port = createMockBackupPort(initial);
    const pruned = await port.prune();
    expect(pruned).toEqual({
      ...original,
      totalBytes: 750,
      repositories: [
        { ...original.repositories[0], points: original.repositories[0]!.points.slice(2) },
        { ...original.repositories[1], points: original.repositories[1]!.points.slice(1) },
      ],
    });
    expect(initial).toEqual(original);
    expect(await port.read()).toEqual(pruned);
    await expect(port.restore('a-old')).rejects.toMatchObject({ code: 'backup.stale' });
    await expect(port.restore('b-old')).rejects.toMatchObject({ code: 'backup.stale' });
    expect(await port.restore('a-latest-tie')).toEqual({ path: '/mock/restored/first' });
    expect(await port.restore('b-latest')).toEqual({ path: '/mock/restored/second' });
    expect(await port.prune()).toEqual(pruned);
  });

  it.each([
    { corruptPoints: 1, scanning: false, code: 'backup.invalid' },
    { corruptPoints: 1, scanning: true, code: 'backup.invalid' },
  ])('rejects $code atomically before removing any point', async ({ code, ...state }) => {
    const initial = { ...snapshot(), ...state };
    const port = createMockBackupPort(initial);
    await expect(port.prune()).rejects.toMatchObject({ code });
    expect(await port.read()).toEqual(initial);
  });

  it('refuses mutations while the initial scan has not supplied any known points', async () => {
    const initial = { ...snapshot(), scanning: true, totalBytes: 0, repositories: [] };
    const port = createMockBackupPort(initial);
    await expect(port.prune()).rejects.toMatchObject({ code: 'backup.unavailable' });
    await expect(port.delete('missing')).rejects.toMatchObject({ code: 'backup.unavailable' });
    expect(await port.read()).toEqual(initial);
  });

  it('preserves empty repositories and returns a detached snapshot even when nothing is removed', async () => {
    const initial = snapshot();
    initial.repositories = initial.repositories.map((repository) => ({
      ...repository,
      points: [],
    }));
    initial.totalBytes = 0;
    const port = createMockBackupPort(initial);
    const pruned = await port.prune();
    expect(pruned).toEqual(initial);
    pruned.repositories[0]!.name = 'changed by caller';
    expect(await port.read()).toEqual(initial);
  });

  it('does not expose mutable state through the pruning result', async () => {
    const port = createMockBackupPort(snapshot());
    const pruned = await port.prune();
    const expected = structuredClone(pruned);
    pruned.repositories[0]!.points[0]!.bytes = 1;
    pruned.repositories[1]!.name = 'changed by caller';
    pruned.repositories = [];
    pruned.totalBytes = 0;
    expect(await port.read()).toEqual(expected);
  });
});

function limitSnapshot(): BackupSnapshot {
  const initial = snapshot();
  initial.totalBytes *= 1048576;
  initial.maxBytes = 2048 * 1048576;
  initial.repositories = initial.repositories.map((repository) => ({
    ...repository,
    points: repository.points.map((point) => ({ ...point, bytes: point.bytes * 1048576 })),
  }));
  initial.lastAutoPrune = { id: 'previous-event', removedCount: 1, freedBytes: 20 };
  return initial;
}

describe('mock backup limit plans', () => {
  it('previews the minimum oldest-first removal globally while protecting every latest tie', async () => {
    const initial = limitSnapshot();
    initial.totalBytes += 7 * 1048576; // Fixed usage is not falsely claimed as reclaimable.
    const port = createMockBackupPort(initial);
    const plan = await port.previewLimit(1000);
    expect(plan).toMatchObject({
      maxMiB: 1000,
      currentBytes: 1082 * 1048576,
      projectedBytes: 957 * 1048576,
      minimumBytes: 757 * 1048576,
      deleteCount: 2,
      feasible: true,
    });
    expect(plan.token).not.toBe('');
    expect(await port.read()).toEqual(initial);
    const persist = vi.fn();
    await port.writePolicy({ enabled: false, maxMiB: 1000 }, plan.token, persist);
    expect(persist).toHaveBeenCalledExactlyOnceWith();
    const after = await port.read();
    expect(after).toMatchObject({
      totalBytes: 957 * 1048576,
      maxBytes: 1000 * 1048576,
      enabled: false,
      lastAutoPrune: initial.lastAutoPrune,
    });
    expect(
      after.repositories.flatMap((repository) => repository.points.map((point) => point.id)),
    ).toEqual(['a-middle', 'a-latest', 'a-latest-tie', 'b-latest']);
    expect(initial.repositories[0]!.points).toHaveLength(4);
  });

  it('rejects an impossible reduction and unapproved deletion without persisting or changing points', async () => {
    const initial = limitSnapshot();
    const port = createMockBackupPort(initial);
    const impossible = await port.previewLimit(700);
    expect(impossible).toMatchObject({
      feasible: false,
      minimumBytes: 750 * 1048576,
      projectedBytes: 750 * 1048576,
      deleteCount: 0,
    });
    const persist = vi.fn();
    await expect(
      port.writePolicy({ enabled: true, maxMiB: 700 }, impossible.token, persist),
    ).rejects.toMatchObject({ code: 'backup.limitTooSmall' });
    await expect(
      port.writePolicy({ enabled: true, maxMiB: 1000 }, undefined, persist),
    ).rejects.toMatchObject({ code: 'backup.limitChanged' });
    expect(persist).not.toHaveBeenCalled();
    expect(await port.read()).toEqual(initial);
  });

  it('rejects tokens for a different limit, store or changed catalog even when no deletion is now needed', async () => {
    const port = createMockBackupPort(limitSnapshot());
    const foreign = createMockBackupPort(limitSnapshot());
    const plan = await port.previewLimit(1000);
    const persist = vi.fn();
    await expect(
      port.writePolicy({ enabled: true, maxMiB: 800 }, plan.token, persist),
    ).rejects.toMatchObject({ code: 'backup.limitChanged' });
    await expect(
      foreign.writePolicy({ enabled: true, maxMiB: 1000 }, plan.token, persist),
    ).rejects.toMatchObject({ code: 'backup.limitChanged' });
    await port.delete('a-old');
    const afterDelete = await port.read();
    await expect(
      port.writePolicy({ enabled: true, maxMiB: 1000 }, plan.token, persist),
    ).rejects.toMatchObject({ code: 'backup.limitChanged' });
    expect(await port.read()).toEqual(afterDelete);
    expect(persist).not.toHaveBeenCalled();
  });

  it('does not mutate backup data when settings persistence fails', async () => {
    const initial = limitSnapshot();
    const port = createMockBackupPort(initial);
    const plan = await port.previewLimit(1000);
    const error = new Error('disk full');
    const persist = vi.fn(() => {
      throw error;
    });
    await expect(
      port.writePolicy({ enabled: true, maxMiB: 1000 }, plan.token, persist),
    ).rejects.toBe(error);
    expect(await port.read()).toEqual(initial);
    expect(await port.previewLimit(1000)).toEqual(plan);
  });

  it('accepts reductions without deletion and returns detached previews and event metadata', async () => {
    const initial = limitSnapshot();
    const port = createMockBackupPort(initial);
    const preview = await port.previewLimit(1500);
    expect(preview).toMatchObject({ deleteCount: 0, projectedBytes: initial.totalBytes });
    preview.deleteCount = 999;
    await port.writePolicy({ enabled: true, maxMiB: 1500 }, undefined, vi.fn());
    const read = await port.read();
    expect(read.repositories).toEqual(initial.repositories);
    read.lastAutoPrune!.removedCount = 999;
    expect((await port.read()).lastAutoPrune).toEqual(initial.lastAutoPrune);
  });

  it('rejects corrupt previews and reductions but permits equal or increased limits without deleting', async () => {
    const initial = { ...limitSnapshot(), corruptPoints: 1, scanning: true };
    const port = createMockBackupPort(initial);
    await expect(port.previewLimit(1000)).rejects.toMatchObject({ code: 'backup.invalid' });
    const persist = vi.fn();
    await expect(
      port.writePolicy({ enabled: true, maxMiB: 1000 }, undefined, persist),
    ).rejects.toMatchObject({ code: 'backup.invalid' });
    await port.writePolicy({ enabled: false, maxMiB: 2048 }, 'irrelevant-token', persist);
    await port.writePolicy({ enabled: true, maxMiB: 3000 }, undefined, persist);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(await port.read()).toEqual({ ...initial, enabled: true, maxBytes: 3000 * 1048576 });
  });

  it('does not prune legacy usage when an increased limit is still below the protected minimum', async () => {
    const initial = { ...limitSnapshot(), maxBytes: 100 * 1048576 };
    const port = createMockBackupPort(initial);
    await port.writePolicy({ enabled: true, maxMiB: 200 }, undefined, vi.fn());
    expect(await port.read()).toEqual({ ...initial, maxBytes: 200 * 1048576 });
  });

  it.each([0, -1, 1.5, Infinity, 1048577])(
    'rejects invalid limit %s without mutation',
    async (maxMiB) => {
      const initial = limitSnapshot();
      const port = createMockBackupPort(initial);
      await expect(port.previewLimit(maxMiB)).rejects.toMatchObject({ code: 'backup.invalid' });
      expect(await port.read()).toEqual(initial);
    },
  );
});
