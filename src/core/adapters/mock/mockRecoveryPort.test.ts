import { expect, it } from 'vitest';
import type { RecoveryPoint } from '@core/domain/recovery';
import { createMockRecoveryPort } from './mockRecoveryPort';

it('limpia sólo datos terminados inactivos y preserva pendientes, activos y heredados', async () => {
  const point: RecoveryPoint = {
    id: 'unused',
    repository: '/mock/repo',
    createdAt: 1000,
    label: '',
    status: 'completed',
    fileCount: 1,
    bytes: 10,
    active: false,
  };
  const port = createMockRecoveryPort({
    directory: '/mock/recovery',
    totalBytes: 40,
    checkpoints: [
      point,
      { ...point, id: 'active', active: true },
      { ...point, id: 'pending', status: 'pending' },
      { ...point, id: 'legacy', status: 'legacy' },
    ],
  });
  expect(await port.cleanup()).toEqual({ removed: 1, freedBytes: 10 });
  const next = await port.read();
  expect(next.checkpoints.map((candidate) => candidate.id)).toEqual([
    'active',
    'pending',
    'legacy',
  ]);
  expect(next.totalBytes).toBe(30);
  expect(Object.keys(port).sort()).toEqual(['cleanup', 'read']);
});
