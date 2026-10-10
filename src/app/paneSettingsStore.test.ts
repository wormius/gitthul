import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type SettingsPatch } from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';

import { createPaneSettingsStore } from './paneSettingsStore';

function spyPort(patch: SettingsPort['patch']) {
  return { read: () => Promise.resolve(DEFAULT_SETTINGS), patch, flush: () => Promise.resolve() };
}

describe('createPaneSettingsStore', () => {
  it('responde al instante con lo que se leyó al arrancar', () => {
    const store = createPaneSettingsStore(
      spyPort(() => Promise.resolve()),
      { ...DEFAULT_SETTINGS, panes: { 'working.left': 0.28 } },
    );

    expect(store.read('working.left')).toBe(0.28);
    expect(store.read('working.right')).toBeNull();
  });

  it('cada escritura llega al puerto y se puede volver a leer sin esperarla', () => {
    const patches: SettingsPatch[] = [];
    const store = createPaneSettingsStore(
      spyPort((patch) => {
        patches.push(patch);

        return Promise.resolve();
      }),
      DEFAULT_SETTINGS,
    );

    store.write('working.left', 0.4);

    expect(store.read('working.left')).toBe(0.4);
    expect(patches).toEqual([{ panes: { 'working.left': 0.4 } }]);
  });

  /*
   * Quien arrastra un divisor no quiere un diálogo de error porque el disco
   * esté lleno: el tamaño sigue funcionando en esta sesión y el fallo se cuenta
   * por el registro.
   */
  it('un fallo al guardar no rompe el arrastre', async () => {
    const onError = vi.fn();
    const store = createPaneSettingsStore(
      spyPort(() => Promise.reject(new Error('disco lleno'))),
      DEFAULT_SETTINGS,
      onError,
    );

    expect(() => {
      store.write('working.left', 0.5);
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });

    expect(store.read('working.left')).toBe(0.5);
  });
});
