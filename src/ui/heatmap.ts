/**
 * Cuadrícula del mapa de calor: de una lista de días a semanas en columnas.
 *
 * El calendario se construye hacia atrás desde el día más reciente, no hacia
 * delante desde el más antiguo: lo que nunca se puede recortar es el extremo
 * derecho, porque es el que contesta «¿se ha tocado esto últimamente?».
 */

export interface HeatmapDay {
  /** Fecha en formato ISO corto, `2026-07-26`. */
  date: string;
  value: number;
}

export interface HeatmapCell {
  date: string;
  value: number;
  /** De 0 a `HEAT_LEVELS - 1`. El 0 se reserva para el vacío. */
  level: number;
}

/** Una columna de la cuadrícula: siete días, de lunes a domingo o el orden pedido. */
export type HeatmapWeek = readonly (HeatmapCell | null)[];

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
const TOP_LEVEL = 4;

function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Reparte los valores en cuatro escalones sobre el máximo observado.
 *
 * Los cortes son proporcionales al máximo y no absolutos porque un repositorio
 * con 40 commits al día y otro con 3 tienen que leerse igual de bien; lo que
 * interesa es el relieve, no la cifra.
 */
export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;

  return Math.min(TOP_LEVEL, Math.ceil((value / max) * TOP_LEVEL));
}

export interface HeatmapGrid {
  /** De la más antigua a la más reciente. La última contiene `end`. */
  weeks: readonly HeatmapWeek[];
  max: number;
  total: number;
  from: string;
  to: string;
}

export interface HeatmapOptions {
  /** Último día representado, en ISO. Por defecto, el más reciente de los datos. */
  end?: string;
  /** Cuántas columnas se construyen como máximo. */
  weeks?: number;
  /** 0 es domingo, 1 lunes. Decide en qué fila cae cada día. */
  weekStartsOn?: 0 | 1;
}

export function buildHeatmapGrid(
  days: readonly HeatmapDay[],
  options: HeatmapOptions = {},
): HeatmapGrid {
  const { weeks: weekCount = 53, weekStartsOn = 1 } = options;

  const values = new Map<string, number>();
  let max = 0;
  let total = 0;

  for (const day of days) {
    const value = (values.get(day.date) ?? 0) + day.value;

    values.set(day.date, value);
    total += day.value;
    max = Math.max(max, value);
  }

  const lastIso =
    options.end ?? [...values.keys()].sort().at(-1) ?? toIso(new Date(Date.now() - DAY_MS));
  const last = toUtcDate(lastIso);

  // La última columna se completa hasta el fin de su semana: dejarla a medias
  // desalinearía las filas de los días respecto a las demás columnas.
  const weekday = (last.getUTCDay() - weekStartsOn + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const gridEnd = new Date(last.getTime() + (DAYS_PER_WEEK - 1 - weekday) * DAY_MS);
  const gridStart = new Date(gridEnd.getTime() - (weekCount * DAYS_PER_WEEK - 1) * DAY_MS);

  const grid: HeatmapCell[][] = [];

  for (let index = 0; index < weekCount * DAYS_PER_WEEK; index += 1) {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    const iso = toIso(date);
    const value = values.get(iso) ?? 0;
    const week = Math.floor(index / DAYS_PER_WEEK);

    (grid[week] ??= []).push({ date: iso, value, level: heatLevel(value, max) });
  }

  // Los días posteriores a `end` existen en la cuadrícula pero no han pasado:
  // se dejan como huecos para que no se lean como días sin actividad.
  const weeksOut: HeatmapWeek[] = grid.map((week) =>
    week.map((cell) => (cell.date > lastIso ? null : cell)),
  );

  return {
    weeks: weeksOut,
    max,
    total,
    from: toIso(gridStart),
    to: lastIso,
  };
}
