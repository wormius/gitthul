import { describe, expect, it, vi } from 'vitest';

import { createTauriLinkPort } from './tauriLinkPort';

const available = {
  status: 'available',
  version: '1.1.0',
  url: 'https://github.com/wormius/gitthul/releases/tag/v1.1.0',
};

describe('createTauriLinkPort', () => {
  it.each([{ status: 'current' }, { status: 'empty' }, available])(
    'consulta IPC sin canal y no abre el navegador por consultar: %j',
    async (result) => {
      const call = vi.fn(() => Promise.resolve(result));
      const openUrl = vi.fn();
      const link = createTauriLinkPort(openUrl, call);
      await expect(link.checkRelease()).resolves.toEqual(result);
      expect(call).toHaveBeenCalledExactlyOnceWith('releases_check', {});
      expect(openUrl).not.toHaveBeenCalled();
    },
  );

  it('propaga fallos de consulta para permitir reintentos', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 429'))
      .mockResolvedValueOnce({ status: 'current' });
    const link = createTauriLinkPort(vi.fn(), call);
    await expect(link.checkRelease()).rejects.toThrow('HTTP 429');
    await expect(link.checkRelease()).resolves.toEqual({ status: 'current' });
  });

  it('delega HTTP(S) normalizado al navegador del sistema', async () => {
    const openUrl = vi.fn(() => Promise.resolve());
    const link = createTauriLinkPort(openUrl);
    await link.openExternal(available.url);
    expect(openUrl).toHaveBeenCalledWith(available.url);
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
