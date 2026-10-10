import { createContext, useContext, type ReactNode } from 'react';

/**
 * El reparto de columnas, compartido entre la cabecera y todas las filas.
 *
 * Va por contexto y no por props porque las filas las pinta quien consume la
 * tabla — normalmente dentro de una `VirtualList` — y hacerlas cargar con el
 * ancho de cada columna las obligaría a repintarse enteras cada vez que alguien
 * arrastra un separador.
 */

export interface DataGridColumn {
  key: string;
  header: ReactNode;
  /** Nombre en el menú de mostrar y ocultar columnas. */
  name?: string;
  /** Nombre accesible del separador de ancho. Sin él se usa `name`. */
  resizeLabel?: string;
  /** Ancho inicial en píxeles; una columna flexible usa el espacio disponible. */
  width: number;
  minWidth?: number;
  /** Límite superior, para columnas cuyo contenido tiene un ancho natural finito. */
  maxWidth?: number;
  /** Absorbe el espacio sobrante al cambiar el tamaño del panel. */
  grow?: boolean;
  resizable?: boolean;
  /** Falso en la columna del grafo: sin ella la tabla deja de contar la historia. */
  hideable?: boolean;
  /**
   * Ancho del contenido cuando la columna tiene su propio scroll horizontal.
   * Es el caso del grafo: las calles pueden pasarse del ancho de la columna sin
   * arrastrar consigo el resto de la tabla.
   */
  contentWidth?: number;
  align?: 'start' | 'end';
}

export interface DataGridLayout {
  /** Solo las visibles, en orden y con su ancho efectivo ya resuelto. */
  columns: readonly DataGridColumn[];
  widthOf: (key: string) => number;
  template: string;
  /** Desplazamiento horizontal de la columna con scroll propio, en píxeles. */
  columnScroll: number;
}

export const DataGridContext = createContext<DataGridLayout | null>(null);

export function useDataGridLayout(): DataGridLayout {
  const layout = useContext(DataGridContext);

  if (!layout) throw new Error('DataGridRow y DataGridCell solo funcionan dentro de un DataGrid');

  return layout;
}

export const DEFAULT_MIN_WIDTH = 48;

/** Ajusta preferencias al panel; si ni los mínimos caben, los comprime proporcionalmente. */
export function fitColumnWidths(
  columns: readonly DataGridColumn[],
  preferred: (key: string) => number,
  available: number,
): Record<string, number> {
  const result = Object.fromEntries(
    columns.map((column) => [
      column.key,
      Math.min(
        column.maxWidth ?? Infinity,
        Math.max(column.minWidth ?? DEFAULT_MIN_WIDTH, preferred(column.key)),
      ),
    ]),
  );
  if (available <= 0 || columns.length === 0) return result;
  const minimum = columns.reduce((sum, column) => sum + (column.minWidth ?? DEFAULT_MIN_WIDTH), 0);
  if (minimum > available) {
    for (const column of columns) {
      result[column.key] = ((column.minWidth ?? DEFAULT_MIN_WIDTH) / minimum) * available;
    }
    return result;
  }
  let excess = Object.values(result).reduce((sum, width) => sum + width, 0) - available;
  const flexible = columns.find((column) => column.grow);
  if (flexible && excess > 0) {
    const reduction = Math.min(
      excess,
      result[flexible.key]! - (flexible.minWidth ?? DEFAULT_MIN_WIDTH),
    );
    result[flexible.key]! -= reduction;
    excess -= reduction;
  }
  if (excess > 0) {
    const capacity = columns.reduce(
      (sum, column) => sum + result[column.key]! - (column.minWidth ?? DEFAULT_MIN_WIDTH),
      0,
    );
    for (const column of columns) {
      const spare = result[column.key]! - (column.minWidth ?? DEFAULT_MIN_WIDTH);
      result[column.key]! -= (excess * spare) / capacity;
    }
  } else if (excess < 0) {
    // El mensaje absorbe espacio nuevo al ampliar el panel o esconder columnas.
    const recipients = flexible
      ? [flexible, ...columns.filter((column) => column !== flexible).reverse()]
      : [...columns].reverse();
    let remaining = -excess;
    for (const recipient of recipients) {
      const addition = Math.min(
        remaining,
        (recipient.maxWidth ?? Infinity) - result[recipient.key]!,
      );
      result[recipient.key]! += addition;
      remaining -= addition;
    }
  }
  return result;
}

/** Mueve un borde interior tomando espacio únicamente de las columnas a su derecha. */
export function resizeColumnWidths(
  columns: readonly DataGridColumn[],
  current: Record<string, number>,
  key: string,
  desired: number,
): Record<string, number> {
  const index = columns.findIndex((column) => column.key === key);
  const column = columns[index];
  if (!column || index === columns.length - 1) return current;
  const next = { ...current };
  const after = columns.slice(index + 1).filter((candidate) => candidate.resizable !== false);
  const base = current[key]!;
  let delta =
    Math.min(column.maxWidth ?? Infinity, Math.max(column.minWidth ?? DEFAULT_MIN_WIDTH, desired)) -
    base;
  const capacity = after.reduce(
    (sum, candidate) =>
      sum +
      (delta > 0
        ? Math.max(0, current[candidate.key]! - (candidate.minWidth ?? DEFAULT_MIN_WIDTH))
        : Math.max(0, (candidate.maxWidth ?? Infinity) - current[candidate.key]!)),
    0,
  );
  delta = Math.sign(delta) * Math.min(Math.abs(delta), capacity);
  // Un panel inferior a la suma de mínimos no permite ensanchar ninguna columna.
  let remaining = Math.abs(delta);
  for (const candidate of after) {
    const width = next[candidate.key]!;
    const room =
      delta > 0
        ? Math.max(0, width - (candidate.minWidth ?? DEFAULT_MIN_WIDTH))
        : Math.max(0, (candidate.maxWidth ?? Infinity) - width);
    const amount = Math.min(remaining, room);
    next[candidate.key] = width - Math.sign(delta) * amount;
    remaining -= amount;
  }
  next[key] = base + delta;
  return next;
}

export function gridTemplate(
  columns: readonly DataGridColumn[],
  widthOf: (key: string) => number,
): string {
  return columns
    .map((column) => (column.grow ? 'minmax(0, 1fr)' : `${String(widthOf(column.key))}px`))
    .join(' ');
}
