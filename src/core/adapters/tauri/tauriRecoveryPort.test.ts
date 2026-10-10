import { expect, it, vi } from 'vitest';
import { createTauriRecoveryPort } from './tauriRecoveryPort';

it('conecta las operaciones de recuperación con sus argumentos nativos exactos', async () => {
  const call = vi.fn((_command: string, _args?: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve(false),
  );
  const port = createTauriRecoveryPort(call);
  await port.read();
  await port.cleanup();
  await port.importLegacy();
  await port.remove('point');
  await port.preview('point');
  await port.restore('token');
  await port.cancelPreview('token');
  expect(await port.export('point')).toBe(false);
  await port.openDirectory();
  expect(call.mock.calls).toEqual([
    ['recovery_read'],
    ['recovery_cleanup'],
    ['recovery_import_legacy'],
    ['recovery_remove', { id: 'point' }],
    ['recovery_preview', { id: 'point' }],
    ['recovery_restore', { token: 'token' }],
    ['recovery_cancel_preview', { token: 'token' }],
    ['recovery_export', { id: 'point' }],
    ['recovery_open_directory'],
  ]);
});

it('conserva un error estructurado y no lo convierte en una cancelación', async () => {
  const failure = { code: 'recovery.unavailable', params: {}, output: 'Permission denied' };
  const port = createTauriRecoveryPort(() => Promise.reject(new Error(JSON.stringify(failure))));
  await expect(port.read()).rejects.toThrow('Permission denied');
});
