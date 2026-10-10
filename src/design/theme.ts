/**
 * Las perillas del sistema de diseño y sus valores válidos.
 *
 * Cada una corresponde a un atributo de datos en `<html>` que las capas CSS
 * seleccionan, salvo los dos tamaños de fuente, que son variables numéricas.
 * `theme` y `mode` admiten además `auto`, que delega en el sistema operativo.
 *
 * El catálogo de valores vive en `@core/domain/settings` desde F0.8: es lo que
 * el puerto de ajustes guarda y valida al arrancar, y tener dos listas de temas
 * —una para el CSS y otra para el archivo de configuración— sería tener una de
 * más. Aquí se reexportan para que los componentes sigan importándolas del
 * sistema de diseño, que es donde tiene sentido buscarlas.
 */

import type { Mode, Theme, ThemeSettings, ThemeVariant } from '@core/domain/settings';

export {
  CODE_FONT_SIZE,
  CODE_FONTS,
  DEFAULT_THEME_SETTINGS,
  DENSITIES,
  MODES,
  THEMES,
  THEME_VARIANTS,
  TOAST_POSITIONS,
  UI_FONT_SIZE,
  UI_FONTS,
} from '@core/domain/settings';

export type {
  CodeFont,
  Density,
  Mode,
  Theme,
  ThemeSettings,
  ThemeVariant,
  ToastPosition,
  UiFont,
} from '@core/domain/settings';

/** Tema, variante y modo: lo que de verdad termina escrito en `<html>`. */
export interface ResolvedTheme {
  theme: Theme;
  themeVariant: ThemeVariant;
  mode: Mode;
}

export function resolveTheme(
  settings: ThemeSettings,
  system: { prefersLight: boolean; prefersContrast: boolean },
): ResolvedTheme {
  return {
    theme:
      settings.theme === 'auto' ? (system.prefersContrast ? 'contraste' : 'thul') : settings.theme,
    themeVariant: settings.themeVariant,
    mode: settings.mode === 'auto' ? (system.prefersLight ? 'light' : 'dark') : settings.mode,
  };
}

export function clampFontSize(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}
