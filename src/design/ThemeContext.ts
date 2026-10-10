import { createContext } from 'react';

import type { ResolvedTheme, ThemeSettings } from './theme';

export interface ThemeContextValue {
  /** Lo que el usuario eligió, con `auto` incluido. */
  settings: ThemeSettings;
  /** Lo que terminó aplicado a `<html>` tras resolver los `auto`. */
  resolved: ResolvedTheme;
  /** Cambia una o varias perillas; el resto se conserva. */
  update: (patch: Partial<ThemeSettings>) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
