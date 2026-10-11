import { describe, expect, it } from 'vitest';

import { createMockLinkPort } from './mockLinkPort';

describe('createMockLinkPort', () => {
  it('simula una versión actual sin consultas reales ni abrir un destino', async () => {
    const link = createMockLinkPort();
    await expect(link.checkRelease()).resolves.toEqual({ status: 'current' });
    expect(link.opened).toEqual([]);
  });
});
