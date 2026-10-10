import { parseHexColor, relativeLuminance } from './color';

/** Punto neutro del selector nativo; no se persiste hasta que la persona lo elige. */
export const DEFAULT_USER_COLOR = '#808080';

export const AVATAR_LIGHT_INK = '#ffffff';
export const AVATAR_DARK_INK = '#000000';

/** Elige la tinta de mayor contraste para un fondo libre, fuera de la paleta. */
export function avatarForeground(color: string): string | undefined {
  const rgb = parseHexColor(color);
  if (!rgb || (rgb.a ?? 1) !== 1) return undefined;

  // Punto en que el contraste con blanco y con negro es el mismo.
  const threshold = Math.sqrt(1.05 * 0.05) - 0.05;
  return relativeLuminance(rgb) > threshold ? AVATAR_DARK_INK : AVATAR_LIGHT_INK;
}
