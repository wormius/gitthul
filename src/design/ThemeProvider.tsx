import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ThemeContext, type ThemeContextValue } from './ThemeContext';
import {
  clampFontSize,
  CODE_FONT_SIZE,
  DEFAULT_THEME_SETTINGS,
  resolveTheme,
  UI_FONT_SIZE,
  type ThemeSettings,
} from './theme';
import { useMediaQuery } from './useMediaQuery';

interface ThemeProviderProps {
  children: ReactNode;
  /** Punto de partida; lo trae `SettingsPort` al arrancar. */
  initialSettings?: Partial<ThemeSettings>;
  /**
   * Qué hacer con cada cambio. La aplicación lo guarda; la galería y las
   * pruebas no pasan nada y el estado se queda en memoria.
   */
  onChange?: (settings: ThemeSettings) => void;
}

/**
 * Escribe las perillas del sistema de diseño en `<html>`.
 *
 * Van en el elemento raíz y no en un contenedor porque el velo de los modales,
 * los flotantes y cualquier cosa que salga por un portal quedan fuera del árbol
 * de React pero dentro del documento: si los tokens vivieran en un div, esas
 * capas se pintarían sin tema.
 *
 * El proveedor no conoce el puerto de ajustes: recibe con qué arrancar y avisa
 * de cada cambio. Así el sistema de diseño sigue sin depender de dónde se
 * guardan las cosas, y la galería puede montarlo sin persistir nada.
 */
export function ThemeProvider({ children, initialSettings, onChange }: ThemeProviderProps) {
  const [settings, setSettings] = useState<ThemeSettings>(() => ({
    ...DEFAULT_THEME_SETTINGS,
    ...initialSettings,
  }));

  const prefersLight = useMediaQuery('(prefers-color-scheme: light)');
  const prefersContrast = useMediaQuery('(prefers-contrast: more)');

  const resolved = useMemo(
    () => resolveTheme(settings, { prefersLight, prefersContrast }),
    [settings, prefersLight, prefersContrast],
  );

  const update = useCallback((patch: Partial<ThemeSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };

      return {
        ...next,
        uiFontSize: clampFontSize(next.uiFontSize, UI_FONT_SIZE),
        codeFontSize: clampFontSize(next.codeFontSize, CODE_FONT_SIZE),
      };
    });
  }, []);

  /*
   * Se avisa cuando el objeto de ajustes cambia de identidad, que solo pasa por
   * `update`. Comparar la referencia y no un valor es lo que evita que el doble
   * montaje del modo estricto guarde un cambio que nadie hizo.
   */
  const persisted = useRef(settings);

  useEffect(() => {
    if (persisted.current === settings) return;

    persisted.current = settings;
    onChange?.(settings);
  }, [settings, onChange]);

  useLayoutEffect(() => {
    const root = document.documentElement;

    root.dataset['theme'] = resolved.theme;
    root.dataset['themeVariant'] = resolved.themeVariant;
    root.dataset['mode'] = resolved.mode;
    root.dataset['density'] = settings.density;
    root.dataset['fontUi'] = settings.uiFont;
    root.dataset['fontCode'] = settings.codeFont;

    root.style.setProperty('--font-size-ui', `${String(settings.uiFontSize)}px`);
    root.style.setProperty('--font-size-code', `${String(settings.codeFontSize)}px`);
  }, [resolved, settings]);

  const value = useMemo<ThemeContextValue>(
    () => ({ settings, resolved, update }),
    [settings, resolved, update],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
