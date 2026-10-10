import { describe, expect, it, vi } from 'vitest';

import { createTauriLinkPort } from './tauriLinkPort';

describe('createTauriLinkPort', () => {
  it('no invoca IPC ni abre enlaces mientras no haya origen público configurado', async () => {
    const call = vi.fn(() => Promise.resolve({ status: 'current' }));
    const openUrl = vi.fn();
    const link = createTauriLinkPort(openUrl, call);
    for (const channel of ['stable', 'beta'] as const) {
      await expect(link.checkRelease(channel)).resolves.toEqual({ status: 'notConfigured' });
    }
    expect(call).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('delega HTTP(S) normalizado al navegador del sistema', async () => {
    const openUrl = vi.fn(() => Promise.resolve());
    const link = createTauriLinkPort(openUrl);

    await link.openExternal('https://example.test/docs');

    expect(openUrl).toHaveBeenCalledWith('https://example.test/docs');
  });

  it('rechaza protocolos ajenos y direcciones con credenciales antes de llamar al sistema', async () => {
    const openUrl = vi.fn(() => Promise.resolve());
    const link = createTauriLinkPort(openUrl);

    await expect(link.openExternal('javascript:alert(1)')).rejects.toThrow(
      'Dirección externa no permitida',
    );
    await expect(link.openExternal('https://user:secret@example.test')).rejects.toThrow(
      'Dirección externa no permitida',
    );
    expect(openUrl).not.toHaveBeenCalled();
  });
});
