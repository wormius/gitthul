import { describe, expect, it, vi } from 'vitest';

import { createTauriSystemPort } from './tauriSystemPort';

describe('createTauriSystemPort', () => {
  it('usa el portapapeles nativo solo tras una acción explícita y propaga sus errores', async () => {
    const call = vi.fn().mockResolvedValue('texto\ncon acentos: canción');
    const system = createTauriSystemPort(vi.fn().mockResolvedValue(null), call);
    expect(call).not.toHaveBeenCalled();
    await system.writeClipboardText('selección\nexacta');
    expect(call).toHaveBeenLastCalledWith('plugin:clipboard-manager|write_text', {
      text: 'selección\nexacta',
    });
    await expect(system.readClipboardText()).resolves.toBe('texto\ncon acentos: canción');
    expect(call).toHaveBeenLastCalledWith('plugin:clipboard-manager|read_text');
    call.mockRejectedValue(new Error('clipboard unavailable'));
    await expect(system.writeClipboardText('fallo')).rejects.toThrow('clipboard unavailable');
    await expect(system.readClipboardText()).rejects.toThrow('clipboard unavailable');
  });

  it('abre un selector de una sola carpeta y conserva titulo y comienzo', async () => {
    const pick = vi.fn().mockResolvedValue('/home/example/projects/gitthul');
    const system = createTauriSystemPort(pick);

    await expect(
      system.pickDirectory({ title: 'Abrir repositorio', startAt: '/home/example/projects' }),
    ).resolves.toBe('/home/example/projects/gitthul');
    expect(pick).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: 'Abrir repositorio',
      defaultPath: '/home/example/projects',
    });
  });

  it('trata cancelar como resultado esperado y tolera la forma multiple del plugin', async () => {
    const pick = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(['/home/example/projects/uno']);
    const system = createTauriSystemPort(pick);

    await expect(system.pickDirectory()).resolves.toBeNull();
    await expect(system.pickDirectory()).resolves.toBe('/home/example/projects/uno');
  });

  it('abre la ruta exacta dentro del explorador del sistema', async () => {
    const call = vi.fn().mockResolvedValue(undefined);
    const system = createTauriSystemPort(vi.fn().mockResolvedValue(null), call);

    await system.revealPath('/home/example/projects/gitthul');

    expect(call).toHaveBeenCalledWith('system_open_directory', {
      path: '/home/example/projects/gitthul',
    });
  });
});
