/**
 * La aritmética de `MarkerScrollbar`, sin DOM.
 *
 * Todo lo que la barra hace es convertir dos números en dos porcentajes y al
 * revés; el resto es pintar. Separarlo permite probar los casos que de verdad
 * duelen —la marca de una sola línea en un archivo de cien mil, el rango que se
 * sale, el total en cero— sin montar nada.
 */

/**
 * Tono de una marca.
 *
 * Nombres del sistema de diseño, no del dominio: la barra no sabe qué es un
 * hunk. Quien la use decide que un bloque añadido se pinta `added`.
 */
export type MarkerTone =
  'added' | 'removed' | 'mixed' | 'changed' | 'conflict' | 'neutral' | 'ours' | 'theirs';

export interface ScrollMarker {
  id: string;
  /** Dónde empieza, en la unidad de `total`. */
  from: number;
  /** Dónde acaba. Si falta, la marca es un punto. */
  to?: number;
  tone: MarkerTone;
  /** Nombre accesible, ya traducido. Hace falta si la marca se puede pulsar. */
  label?: string;
}

/** Posición y alto de una marca, en porcentaje de la pista. */
export interface MarkerBand {
  top: number;
  height: number;
}

/**
 * Lo menos que puede medir una marca, en porcentaje de la pista.
 *
 * Un cambio de una línea en un archivo de diez mil ocupa un 0,01 % y no se ve.
 * Una marca que no se ve es peor que no ponerla, porque el archivo parece
 * limpio; así que por debajo de este umbral la marca se estira.
 */
export const MINIMUM_BAND = 0.35;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Cuatro decimales, que sobre una barra de trescientos píxeles son la
 * diezmilésima de píxel. Sin esto, dividir deja porcentajes como
 * `14.000000000000002%` escritos en el atributo `style` de cada marca.
 */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Dónde cae una marca sobre la pista.
 *
 * Un `total` de cero o negativo no es un error de quien llama: es un documento
 * vacío que todavía no se ha medido. Se devuelve la marca al principio en vez
 * de dividir por cero.
 */
export function markerBand(marker: ScrollMarker, total: number): MarkerBand {
  if (!(total > 0)) return { top: 0, height: MINIMUM_BAND };

  const from = clamp(Math.min(marker.from, marker.to ?? marker.from), 0, total);
  const to = clamp(Math.max(marker.from, marker.to ?? marker.from), 0, total);

  const top = (from / total) * 100;
  const height = Math.max(((to - from) / total) * 100, MINIMUM_BAND);

  // Estirar la marca no puede sacarla de la pista: al final del documento se
  // recorta el arranque en vez de desbordar por abajo.
  return { top: round(Math.min(top, 100 - height)), height: round(height) };
}

/** La ventana visible, en porcentaje de la pista. Nunca deja de verse. */
export function viewportBand(from: number, to: number, total: number): MarkerBand {
  return markerBand({ id: 'viewport', from, to, tone: 'neutral' }, total);
}

/**
 * A qué posición del documento apunta un clic en la pista.
 *
 * Se centra la ventana en el punto pulsado —restando media ventana— porque el
 * gesto se lee como «llévame ahí», no como «pon ahí el borde de arriba».
 */
export function seekPosition(
  offset: number,
  trackLength: number,
  total: number,
  windowSize = 0,
): number {
  if (!(trackLength > 0) || !(total > 0)) return 0;

  const position = (clamp(offset, 0, trackLength) / trackLength) * total;

  return clamp(position - windowSize / 2, 0, Math.max(total - windowSize, 0));
}
