import { describe, expect, it, vi } from 'vitest';

import { createTauriKeyringPort } from './tauriKeyringPort';

const credential = { kind: 'remote', id: 'github.com:trabajo' } as const;

describe('createTauriKeyringPort', () => {
  it('solo expone presencia y escrituras opacas con argumentos exactos', async () => {
    const call = vi
      .fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(undefined);
    const keyring = createTauriKeyringPort(call);

    await expect(keyring.isAvailable()).resolves.toBe(true);
    await expect(keyring.has(credential)).resolves.toBe(false);
    await keyring.set(credential, 'token-que-no-regresa');
    await keyring.delete(credential);

    expect(call.mock.calls).toEqual([
      ['keyring_is_available'],
      ['keyring_has', { credential }],
      ['keyring_set', { credential, secret: 'token-que-no-regresa' }],
      ['keyring_delete', { credential }],
    ]);
    expect(keyring).not.toHaveProperty('get');
  });
});
