import { describe, expect, it } from 'vitest';

import { createMockKeyringPort } from './mockKeyringPort';

const github = { kind: 'remote', id: 'github.com' } as const;

describe('createMockKeyringPort', () => {
  it('guarda, consulta y borra por referencia sin devolver el secreto', async () => {
    const keyring = createMockKeyringPort();

    expect(await keyring.has(github)).toBe(false);

    await keyring.set(github, 'token-de-prueba');
    expect(await keyring.has(github)).toBe(true);

    await keyring.delete(github);

    expect(await keyring.has(github)).toBe(false);
  });

  it('puede fingir que el sistema no tiene gestor de llaves', async () => {
    expect(await createMockKeyringPort().isAvailable()).toBe(true);
    expect(await createMockKeyringPort({ available: false }).isAvailable()).toBe(false);
  });
});
