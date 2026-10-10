import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS, type SettingsPatch } from '@core/domain/settings';
import type { SettingsPort } from '@core/ports/SettingsPort';

import { coalesceSettingsWrites } from './coalesceSettings';

function spyPort() {
  const patches: SettingsPatch[] = [];

  const port: SettingsPort = {
    read: () => Promise.resolve(DEFAULT_SETTINGS),
    patch: (patch) => {
      patches.push(patch);

      return Promise.resolve();
    },
    flush: () => Promise.resolve(),
  };

  return { port, patches };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('coalesceSettingsWrites', () => {
  it('agrupa campos de recuperación sin perder los límites anteriores del mismo parche', async () => {
    const { port, patches } = spyPort();
    const coalesced = coalesceSettingsWrites(port);
    await coalesced.patch({ recovery: { maxCheckpoints: 25, autoCleanup: false } });
    await coalesced.patch({ recovery: { maxAgeDays: 10 } });
    await coalesced.flush();
    expect(patches).toEqual([
      { recovery: { maxCheckpoints: 25, autoCleanup: false, maxAgeDays: 10 } },
    ]);
  });
  /*
   * Arrastrar un divisor produce un cambio por cuadro. Sin agrupar, eso serían
   * sesenta escrituras por segundo de un número que va a cambiar otra vez en
   * dieciséis milisegundos.
   */
  it('funde en una sola escritura lo que llega seguido', async () => {
    const { port, patches } = spyPort();
    const coalesced = coalesceSettingsWrites(port, { delay: 100 });

    await coalesced.patch({ panes: { 'working.left': 0.3 } });
    await coalesced.patch({ panes: { 'working.left': 0.35 } });
    await coalesced.patch({ panes: { 'working.right': 0.7 } });

    expect(patches).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(100);

    expect(patches).toEqual([{ panes: { 'working.left': 0.35, 'working.right': 0.7 } }]);
  });

  it('conserva la última elección de cada ajuste', async () => {
    const { port, patches } = spyPort();
    const coalesced = coalesceSettingsWrites(port, { delay: 100 });

    await coalesced.patch({ appearance: { theme: 'abismo' } });
    await coalesced.patch({ locale: 'de' });
    await coalesced.patch({ appearance: { theme: 'grimorio', density: 'compact' } });

    await vi.advanceTimersByTimeAsync(100);

    expect(patches).toEqual([
      { appearance: { theme: 'grimorio', density: 'compact' }, locale: 'de' },
    ]);
  });

  it('vaciar escribe ya lo que estaba pendiente', async () => {
    const { port, patches } = spyPort();
    const coalesced = coalesceSettingsWrites(port, { delay: 10_000 });

    await coalesced.patch({ locale: 'fr' });
    await coalesced.flush();

    expect(patches).toEqual([{ locale: 'fr' }]);

    // Y no vuelve a escribir lo mismo cuando venza el temporizador.
    await vi.advanceTimersByTimeAsync(10_000);

    expect(patches).toHaveLength(1);
  });

  it('sin nada pendiente no escribe nada', async () => {
    const { port, patches } = spyPort();

    await coalesceSettingsWrites(port).flush();

    expect(patches).toEqual([]);
  });

  it('un fallo al guardar se cuenta, no se propaga', async () => {
    const onError = vi.fn();
    const failing: SettingsPort = {
      read: () => Promise.resolve(DEFAULT_SETTINGS),
      patch: () => Promise.reject(new Error('disco lleno')),
      flush: () => Promise.resolve(),
    };

    const coalesced = coalesceSettingsWrites(failing, { delay: 10, onError });

    await coalesced.patch({ locale: 'en' });
    await vi.advanceTimersByTimeAsync(10);

    expect(onError).toHaveBeenCalledOnce();
  });
});
