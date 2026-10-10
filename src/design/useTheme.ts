import { useContext } from 'react';

import { ThemeContext, type ThemeContextValue } from './ThemeContext';

/** Lee y cambia las perillas del sistema de diseño. Exige estar bajo `ThemeProvider`. */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);

  if (!value) throw new Error('useTheme necesita un ThemeProvider por encima');

  return value;
}
