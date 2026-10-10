import type { Density } from '@core/domain/settings';

/** El aire que la densidad añade arriba y abajo de la fila, en píxeles. */
const ROW_PADDING: Record<Density, number> = { compact: 3, cozy: 6, spacious: 11 };

/**
 * El alto de una píldora de espacio, en múltiplos del tamaño de letra.
 *
 * Son los mismos factores que `--control-height-sm` de cada densidad. Se repiten
 * aquí por lo mismo que el resto del cálculo: el virtualizador necesita píxeles
 * y el token es un `calc()` sin resolver.
 */
const CHIP_HEIGHT: Record<Density, number> = { compact: 1.55, cozy: 1.75, spacious: 2 };

/**
 * Cuánto mide una fila de repositorio.
 *
 * La lista está virtualizada y el virtualizador necesita **un número**, no una
 * expresión de CSS, así que el alto se calcula aquí a partir de los dos ajustes
 * que de verdad lo mueven: el tamaño de letra de la interfaz, que decide la
 * línea, y la densidad, que decide el aire. Leer `--row-height` no serviría: los
 * tokens de densidad son `calc()` sin resolver hasta que alguien los usa, y lo
 * que volvería de `getComputedStyle` sería la expresión, no los píxeles.
 *
 * La fila es de una sola línea —nombre, carpeta y última apertura— y por eso
 * caben muchas: recorrer y encontrar es lo único que se hace en estas dos
 * listas. `chips` es el alto que hace falta cuando con filtro aparecen las
 * píldoras de pertenencia, que miden más que el texto al que acompañan. Lo pide
 * la lista entera y no fila a fila: con filtro hay filas con espacios y filas
 * sin ellos, y el virtualizador reserva **un** alto para todas, así que el que
 * vale es el de la más alta.
 */
export function repoRowHeight(density: Density, uiFontSize: number, chips = false): number {
  const line = chips ? uiFontSize * CHIP_HEIGHT[density] : uiFontSize * 1.5;

  return Math.ceil(line) + ROW_PADDING[density] * 2;
}
