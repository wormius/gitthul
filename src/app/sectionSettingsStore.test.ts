import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type SettingsPatch } from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';

import { createSectionSettingsStore } from './sectionSettingsStore';

function spyPort(patch: SettingsPort['patch']) {
  return { read: () => Promise.resolve(DEFAULT_SETTINGS), patch, flush: () => Promise.resolve() };
}

describe('createSectionSettingsStore', () => {
  it('responde al instante con lo que se leyó al arrancar', () => {
    const store = createSectionSettingsStore(
      spyPort(() => Promise.resolve()),
      { ...DEFAULT_SETTINGS, workingSections: { locals: true } },
    );

    expect(store.read('locals')).toBe(true);
    expect(store.read('tags')).toBeNull();
  });

  it('cada escritura llega al puerto y se puede volver a leer sin esperarla', () => {
    const patches: SettingsPatch[] = [];
    const store = createSectionSettingsStore(
      spyPort((patch) => {
        patches.push(patch);

        return Promise.resolve();
      }),
      DEFAULT_SETTINGS,
    );

    store.write('locals', true);

    expect(store.read('locals')).toBe(true);
    expect(patches).toEqual([{ workingSections: { locals: true } }]);
  });

  /*
   * Igual que con los tamaños de panel: quien pliega una sección no quiere un
   * diálogo de error porque el disco esté lleno.
   */
  it('un fallo al guardar no rompe el plegado', async () => {
    const onError = vi.fn();
    const store = createSectionSettingsStore(
      spyPort(() => Promise.reject(new Error('disco lleno'))),
      DEFAULT_SETTINGS,
      onError,
    );

    expect(() => {
      store.write('locals', true);
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });

    expect(store.read('locals')).toBe(true);
  });
});
