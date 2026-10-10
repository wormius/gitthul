import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '@core/domain/settings';

import { createMockSettingsPort } from './mockSettingsPort';
import { memoryStorage } from './storage';

describe('createMockSettingsPort', () => {
  it('guarda recuperación y la descubre al reiniciar con ajustes antiguos', async () => {
    const storage = memoryStorage(
      JSON.stringify({ locale: 'de', appearance: { theme: 'abismo' } }),
    );
    const first = createMockSettingsPort({ storage });
    expect((await first.read()).recovery).toEqual(DEFAULT_SETTINGS.recovery);
    await first.patch({ recovery: { autoCleanup: false, maxMiB: 256 } });
    const second = createMockSettingsPort({ storage });
    expect((await second.read()).recovery).toEqual({
      ...DEFAULT_SETTINGS.recovery,
      autoCleanup: false,
      maxMiB: 256,
    });
    expect((await second.read()).locale).toBe('de');
  });
  it('arranca con los ajustes de fábrica cuando no hay nada guardado', async () => {
    const port = createMockSettingsPort();

    expect(await port.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('lo que se escribe sobrevive a volver a leer', async () => {
    const storage = memoryStorage();

    const first = createMockSettingsPort({ storage });

    await first.patch({
      appearance: { theme: 'grimorio', themeVariant: 'minimalist' },
      locale: 'fr',
    });
    await first.patch({ panes: { 'working.left': 0.32 } });

    // Un puerto nuevo sobre el mismo almacén es lo que pasa al reiniciar.
    const second = createMockSettingsPort({ storage });
    const settings = await second.read();

    expect(settings.appearance.theme).toBe('grimorio');
    expect(settings.appearance.themeVariant).toBe('minimalist');
    expect(settings.appearance.density).toBe(DEFAULT_SETTINGS.appearance.density);
    expect(settings.locale).toBe('fr');
    expect(settings.panes['working.left']).toBe(0.32);
  });

  it('un archivo corrupto no impide arrancar', async () => {
    const port = createMockSettingsPort({ storage: memoryStorage('{esto no es json') });

    expect(await port.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('valida lo que encuentra en vez de creérselo', async () => {
    const stored = JSON.stringify({ appearance: { theme: 'inventado' }, locale: 'de' });
    const port = createMockSettingsPort({ storage: memoryStorage(stored) });
    const settings = await port.read();

    expect(settings.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme);
    expect(settings.locale).toBe('de');
  });
});
