import { describe, expect, it } from 'vitest';

import { createMockLinkPort } from './mockLinkPort';

describe('createMockLinkPort', () => {
  it('representa la misma indisponibilidad que escritorio sin abrir un destino', async () => {
    const link = createMockLinkPort();
    for (const channel of ['stable', 'beta'] as const) {
      await expect(link.checkRelease(channel)).resolves.toEqual({ status: 'notConfigured' });
    }
    expect(link.opened).toEqual([]);
  });
});
