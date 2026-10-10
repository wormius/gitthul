import type { Density } from '@core/domain/settings';

/**
 * El mismo factor que `--row-height` de `density.css`, para cada densidad.
 *
 * El virtualizador necesita un número de píxeles y no una expresión CSS —
 * mismo motivo que `repoRowHeight` de Repositorios—, así que aquí se repite la
 * fórmula del token en vez de leerlo con `getComputedStyle`, que devolvería el
 * `calc()` sin resolver.
 */
const ROW_HEIGHT_FACTOR: Record<Density, number> = {
  compact: 1.7,
  cozy: 2.05,
  spacious: 2.5,
};

/** Alto de una fila de `CommitTable`, en píxeles, igual al de la cabecera de `DataGrid`. */
export function commitRowHeight(density: Density, uiFontSize: number): number {
  return Math.ceil(uiFontSize * ROW_HEIGHT_FACTOR[density]);
}
