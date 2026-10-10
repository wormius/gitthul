/**
 * Aritmética de color del sistema de diseño.
 *
 * Existe para que la relación de contraste sea comprobable: la prueba de tokens
 * lee los literales de `palette.css` y los mide con estas funciones. Las mismas
 * fórmulas sirven después para el avatar determinista y para decidir el color de
 * texto sobre una etiqueta de rama.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** De 0 a 1. Ausente o `1` es opaco, que es lo que vale casi todo. */
  a?: number;
}

/** El alfa de un color, con lo opaco por defecto. */
export function alphaOf(color: Rgb): number {
  return color.a ?? 1;
}

const HEX = /^#(?:([0-9a-f]{3,4})|([0-9a-f]{6})|([0-9a-f]{8}))$/i;

/**
 * Acepta `#abc`, `#abcd`, `#aabbcc` y `#aabbccdd`.
 *
 * El alfa no es un adorno: los fondos de diff son translúcidos a propósito, para
 * que la selección que se pinta **por debajo** de la línea se vea a través de
 * ellos. Un color con alfa no tiene contraste propio —depende de lo que tenga
 * detrás—, así que quien lo mida tiene que componerlo antes con `over`.
 */
export function parseHexColor(value: string): Rgb | null {
  const match = HEX.exec(value.trim());

  if (!match) return null;

  const short = match[1];
  const full = short ? short.replace(/./g, (c) => c + c) : (match[2] ?? match[3]);

  if (!full) return null;

  const n = Number.parseInt(full.slice(0, 6), 16);
  const alpha = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;

  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: alpha };
}

/** Compone `color` sobre `base`, que es lo que el ojo acaba viendo. */
export function over(color: Rgb, base: Rgb): Rgb {
  const alpha = alphaOf(color);
  const mix = (channel: 'r' | 'g' | 'b') =>
    Math.round(color[channel] * alpha + base[channel] * (1 - alpha));

  return { r: mix('r'), g: mix('g'), b: mix('b'), a: 1 };
}

function toLinear(channel: number): number {
  const c = channel / 255;

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa según WCAG 2.1. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Relación de contraste WCAG, de 1 (idénticos) a 21 (negro contra blanco). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Igual que `contrastRatio`, con hexadecimales. Lanza si alguno no lo es. */
export function hexContrastRatio(a: string, b: string): number {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);

  if (!ca || !cb) throw new Error(`Color no hexadecimal: ${!ca ? a : b}`);

  return contrastRatio(ca, cb);
}
