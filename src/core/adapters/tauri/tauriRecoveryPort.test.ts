import { expect, it, vi } from 'vitest';
import { createTauriRecoveryPort } from './tauriRecoveryPort';

it('expone sólo estadísticas y limpieza de la caché interna', async () => {
  const call = vi.fn((_command: string, _args?: Record<string, unknown>): Promise<unknown> =>
    Promise.resolve(false),
  );
  const port = createTauriRecoveryPort(call);
  await port.read();
  await port.cleanup();
  expect(call.mock.calls).toEqual([['recovery_read'], ['recovery_cleanup']]);
  expect(Object.keys(port).sort()).toEqual(['cleanup', 'read']);
});

it('conserva un error estructurado y no lo convierte en una cancelación', async () => {
  const failure = { code: 'recovery.unavailable', params: {}, output: 'Permission denied' };
  const port = createTauriRecoveryPort(() => Promise.reject(new Error(JSON.stringify(failure))));
  await expect(port.read()).rejects.toThrow('Permission denied');
});
