import { describe, expect, it } from 'vitest';

import { buildHeatmapGrid, heatLevel, type HeatmapDay } from './heatmapUtils';

const days: HeatmapDay[] = [
  { date: '2026-07-20', value: 1 },
  { date: '2026-07-22', value: 10 },
  { date: '2026-07-26', value: 4 },
];

describe('heatLevel', () => {
  it('reserva el cero para el vacío', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
  });

  it('reparte el resto en cuatro escalones sobre el máximo', () => {
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(8, 10)).toBe(4);
  });

  it('no se pasa del último escalón aunque el valor supere el máximo', () => {
    expect(heatLevel(40, 10)).toBe(4);
  });
});

describe('buildHeatmapGrid', () => {
  it('ancla el extremo derecho en el último día y construye hacia atrás', () => {
    const grid = buildHeatmapGrid(days, { end: '2026-07-26', weeks: 4 });

    expect(grid.to).toBe('2026-07-26');
    expect(grid.weeks).toHaveLength(4);

    const dates = grid.weeks.flat().filter((cell) => cell !== null);

    expect(dates.at(-1)?.date).toBe('2026-07-26');
  });

  it('recortar semanas quita las antiguas y deja intacta la última', () => {
    const wide = buildHeatmapGrid(days, { end: '2026-07-26', weeks: 8 });
    const narrow = buildHeatmapGrid(days, { end: '2026-07-26', weeks: 3 });

    expect(narrow.weeks.at(-1)).toEqual(wide.weeks.at(-1));
    expect(narrow.from > wide.from).toBe(true);
  });

  it('cada columna tiene siempre siete filas, para que los días se alineen', () => {
    const grid = buildHeatmapGrid(days, { end: '2026-07-22', weeks: 5 });

    for (const week of grid.weeks) expect(week).toHaveLength(7);
  });

  it('los días posteriores al último son huecos y no ceros', () => {
    // 2026-07-22 es miércoles: quedan cuatro días de su semana sin ocurrir.
    const grid = buildHeatmapGrid(days, { end: '2026-07-22', weeks: 2 });
    const lastWeek = grid.weeks.at(-1) ?? [];

    expect(lastWeek.filter((cell) => cell === null)).toHaveLength(4);
    expect(lastWeek[2]?.date).toBe('2026-07-22');
  });

  it('suma los valores repetidos del mismo día y reporta máximo y total', () => {
    const grid = buildHeatmapGrid(
      [
        { date: '2026-07-26', value: 3 },
        { date: '2026-07-26', value: 5 },
        { date: '2026-07-25', value: 2 },
      ],
      { end: '2026-07-26', weeks: 2 },
    );

    expect(grid.max).toBe(8);
    expect(grid.total).toBe(10);
  });

  it('sin datos no revienta', () => {
    const grid = buildHeatmapGrid([], { end: '2026-07-26', weeks: 2 });

    expect(grid.max).toBe(0);
    expect(grid.weeks).toHaveLength(2);
  });
});
