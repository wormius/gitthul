import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RECOVERY_SETTINGS,
  DEFAULT_SETTINGS,
  mergeSettings,
  normalizeSettings,
  THEMES,
  THEME_VARIANTS,
  UI_FONT_SIZE,
  type Settings,
} from './settings';

describe('ajustes de recuperación', () => {
  it('migra ajustes anteriores sin perder las preferencias existentes', () => {
    const settings = normalizeSettings({
      locale: 'fr',
      appearance: { theme: 'abismo' },
      panes: { main: 0.4 },
    });
    expect(settings.recovery).toEqual(DEFAULT_RECOVERY_SETTINGS);
    expect(settings.locale).toBe('fr');
    expect(settings.appearance.theme).toBe('abismo');
    expect(settings.panes).toEqual({ main: 0.4 });
  });

  it('conserva la política guardada y descarta valores no finitos', () => {
    expect(
      normalizeSettings({
        recovery: { autoCleanup: false, maxCheckpoints: 12, maxAgeDays: 60, maxMiB: 256 },
      }).recovery,
    ).toEqual({ autoCleanup: false, maxCheckpoints: 12, maxAgeDays: 60, maxMiB: 256 });
    expect(
      normalizeSettings({
        recovery: {
          autoCleanup: 'false',
          maxCheckpoints: Number.NaN,
          maxAgeDays: '90',
          maxMiB: Infinity,
        },
      }).recovery,
    ).toEqual(DEFAULT_RECOVERY_SETTINGS);
    expect(
      normalizeSettings({ recovery: { maxCheckpoints: 0, maxAgeDays: 99999, maxMiB: 5.8 } })
        .recovery,
    ).toEqual({ autoCleanup: true, maxCheckpoints: 1, maxAgeDays: 3650, maxMiB: 6 });
  });

  it('un parche de retención conserva el resto de la política', () => {
    const next = mergeSettings(DEFAULT_SETTINGS, { recovery: { maxAgeDays: 14 } });
    expect(next.recovery).toEqual({ ...DEFAULT_RECOVERY_SETTINGS, maxAgeDays: 14 });
    expect(next.appearance).toEqual(DEFAULT_SETTINGS.appearance);
  });
});

describe('normalizeSettings', () => {
  it('acepta lo que reconoce', () => {
    const settings = normalizeSettings({
      appearance: { theme: 'grimorio', mode: 'light', density: 'compact', uiFontSize: 16 },
      locale: 'de',
      panes: { 'working.left': 0.28 },
      workingSections: { locals: true },
      workingWipNames: { repo: '  Entrega en curso  ', vacio: '', invalido: 42 },
    });

    expect(settings.appearance.theme).toBe('grimorio');
    expect(settings.appearance.mode).toBe('light');
    expect(settings.appearance.density).toBe('compact');
    expect(settings.appearance.uiFontSize).toBe(16);
    expect(settings.locale).toBe('de');
    expect(settings.panes['working.left']).toBe(0.28);
    expect(settings.workingSections['locals']).toBe(true);
    expect(settings.workingWipNames).toEqual({ repo: 'Entrega en curso' });
  });

  /*
   * El archivo de ajustes se puede editar a mano y puede venir de una versión
   * anterior. Que un tema con nombre inventado deje la ventana sin abrir sería
   * desproporcionado, así que cada campo cae por su cuenta.
   */
  it('descarta lo que no reconoce sin arrastrar el resto', () => {
    const settings = normalizeSettings({
      appearance: { theme: 'neón', mode: 'light', uiFont: 'comic' },
      locale: 'kl',
      panes: { bueno: 0.5, malo: 'ancho', peor: Number.NaN },
      workingSections: { bueno: true, malo: 'plegado' },
    });

    expect(settings.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme);
    expect(settings.appearance.uiFont).toBe(DEFAULT_SETTINGS.appearance.uiFont);
    expect(settings.appearance.mode).toBe('light');
    expect(settings.locale).toBe('auto');
    expect(settings.panes).toEqual({ bueno: 0.5 });
    expect(settings.workingSections).toEqual({ bueno: true });
  });

  it('recorta los tamaños de fuente a su rango', () => {
    expect(normalizeSettings({ appearance: { uiFontSize: 400 } }).appearance.uiFontSize).toBe(
      UI_FONT_SIZE.max,
    );
    expect(normalizeSettings({ appearance: { uiFontSize: 2 } }).appearance.uiFontSize).toBe(
      UI_FONT_SIZE.min,
    );
  });

  it('sobrevive a que no haya nada guardado', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('esto no es un objeto')).toEqual(DEFAULT_SETTINGS);
  });

  it('recupera ajustes anteriores sin variante conservando el tema elegido', () => {
    const settings = normalizeSettings({ appearance: { theme: 'grimorio', mode: 'light' } });

    expect(settings.appearance.theme).toBe('grimorio');
    expect(settings.appearance.themeVariant).toBe('classic');
    expect(settings.appearance.mode).toBe('light');
    expect(THEMES[0]).toBe('thul');
  });

  it.each(THEME_VARIANTS)('conserva la variante %s al normalizar JSON', (themeVariant) => {
    const saved = JSON.stringify({ appearance: { theme: 'grimorio', themeVariant } });
    const settings = normalizeSettings(JSON.parse(saved));

    expect(settings.appearance.theme).toBe('grimorio');
    expect(settings.appearance.themeVariant).toBe(themeVariant);
  });

  it.each(['inventada', '', null, 7])('descarta una variante inválida: %s', (themeVariant) => {
    const settings = normalizeSettings({ appearance: { theme: 'dual', themeVariant } });

    expect(settings.appearance.theme).toBe('dual');
    expect(settings.appearance.themeVariant).toBe('classic');
  });

  it('descarta el lado de controles guardado por versiones anteriores y conserva los demás ajustes', () => {
    const settings = normalizeSettings({
      appearance: { windowControlsSide: 'left', theme: 'grimorio', uiFontSize: 16 },
    });

    expect(settings.appearance).not.toHaveProperty('windowControlsSide');
    expect(settings.appearance.theme).toBe('grimorio');
    expect(settings.appearance.uiFontSize).toBe(16);
    expect(
      mergeSettings(settings, { appearance: { density: 'compact' } }).appearance,
    ).not.toHaveProperty('windowControlsSide');
  });

  it('normaliza la esquina de las notificaciones', () => {
    expect(
      normalizeSettings({ appearance: { toastPosition: 'bottom-start' } }).appearance.toastPosition,
    ).toBe('bottom-start');
    expect(
      normalizeSettings({ appearance: { toastPosition: 'center' } }).appearance.toastPosition,
    ).toBe('top-end');
  });

  it('conserva metadatos de cuentas sin aceptar secretos ni referencias duplicadas', () => {
    const settings = normalizeSettings({
      git: {
        credentialAccounts: [
          {
            id: 'cuenta-trabajo',
            label: 'Trabajo',
            host: 'github.com',
            username: 'alex-work',
            remotePattern: 'empresa/*',
            secret: 'esto nunca pertenece a settings',
          },
          {
            id: 'cuenta-trabajo',
            label: 'Duplicada',
            host: 'github.com',
            username: 'otra',
          },
          { id: 'incompleta', label: '', host: 'gitlab.com', username: '' },
        ],
      },
    });

    expect(settings.git.credentialAccounts).toEqual([
      {
        id: 'cuenta-trabajo',
        label: 'Trabajo',
        host: 'github.com',
        username: 'alex-work',
        remotePattern: 'empresa/*',
      },
    ]);
    expect(settings.git.credentialAccounts[0]).not.toHaveProperty('secret');
  });
});

describe('mergeSettings', () => {
  const current: Settings = {
    appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'abismo', themeVariant: 'dense' },
    locale: 'fr',
    panes: { 'working.left': 0.3, 'working.right': 0.7 },
    workingSections: { locals: true, tags: false },
    workingWipNames: { '/repos/demo': 'Entrega' },
    git: DEFAULT_SETTINGS.git,
    updates: DEFAULT_SETTINGS.updates,
    recovery: DEFAULT_SETTINGS.recovery,
    logging: DEFAULT_SETTINGS.logging,
  };

  it('conserva lo que el parche no menciona', () => {
    const next = mergeSettings(current, { appearance: { density: 'spacious' } });

    expect(next.appearance.theme).toBe('abismo');
    expect(next.appearance.themeVariant).toBe('dense');
    expect(next.appearance.density).toBe('spacious');
    expect(next.locale).toBe('fr');
    expect(next.panes).toEqual(current.panes);
    expect(next.workingSections).toEqual(current.workingSections);
  });

  it('funde los paneles clave por clave en vez de reemplazarlos', () => {
    const next = mergeSettings(current, { panes: { 'working.left': 0.4 } });

    expect(next.panes).toEqual({ 'working.left': 0.4, 'working.right': 0.7 });
  });

  it('funde las secciones plegadas clave por clave en vez de reemplazarlas', () => {
    const next = mergeSettings(current, { workingSections: { locals: false } });

    expect(next.workingSections).toEqual({ locals: false, tags: false });
  });
});

it('debug solo se activa con un booleano verdadero y no altera otros ajustes', () => {
  for (const debugEnabled of [undefined, 'true', 1, null, false])
    expect(normalizeSettings({ logging: { debugEnabled } }).logging.debugEnabled).toBe(false);
  const settings = mergeSettings(DEFAULT_SETTINGS, { logging: { debugEnabled: true } });
  expect(settings.logging.debugEnabled).toBe(true);
  expect(settings.appearance).toEqual(DEFAULT_SETTINGS.appearance);
  expect(normalizeSettings(JSON.parse(JSON.stringify(settings))).logging.debugEnabled).toBe(true);
});

it('descarta el canal beta heredado y conserva la preferencia explícita de consulta al iniciar', () => {
  const settings = normalizeSettings({ updates: { channel: 'beta', checkOnStartup: true } });
  expect(settings.updates).toEqual({ checkOnStartup: true });
  expect(normalizeSettings(JSON.parse(JSON.stringify(settings))).updates).toEqual({
    checkOnStartup: true,
  });
});

it('la consulta al iniciar está desactivada por defecto y exige un booleano', () => {
  for (const checkOnStartup of [undefined, 'true', 1, null, false]) {
    expect(normalizeSettings({ updates: { channel: 'stable', checkOnStartup } }).updates).toEqual({
      checkOnStartup: false,
    });
  }
  expect(mergeSettings(DEFAULT_SETTINGS, { updates: { checkOnStartup: true } }).updates).toEqual({
    checkOnStartup: true,
  });
});
