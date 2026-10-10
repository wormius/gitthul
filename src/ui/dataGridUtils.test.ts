import { describe, expect, it } from 'vitest';

import { fitColumnWidths, resizeColumnWidths, type DataGridColumn } from './dataGridUtils';

const columns: readonly DataGridColumn[] = [
  { key: 'graph', header: 'Grafo', width: 120, minWidth: 80, maxWidth: 120 },
  { key: 'subject', header: 'Mensaje', width: 500, minWidth: 48, grow: true },
  { key: 'author', header: 'Autor', width: 110, minWidth: 70 },
  { key: 'date', header: 'Fecha', width: 150, minWidth: 130 },
  { key: 'sha', header: 'SHA', width: 90, minWidth: 70 },
];
const preferred = Object.fromEntries(columns.map((column) => [column.key, column.width]));
const total = (widths: Record<string, number>) =>
  Object.values(widths).reduce((sum, width) => sum + width, 0);

describe('columnas restringidas al panel', () => {
  it.each([1200, 970, 600, 398, 200])(
    'caben en un panel de %s px, incluso por debajo de los mínimos',
    (available) => {
      const fitted = fitColumnWidths(columns, (key) => preferred[key]!, available);
      expect(total(fitted)).toBeCloseTo(available);
      expect(Object.values(fitted).every((width) => width > 0)).toBe(true);
      if (available >= 398) {
        for (const column of columns)
          expect(fitted[column.key]).toBeGreaterThanOrEqual(column.minWidth! - 0.00001);
      }
    },
  );

  it('el borde de Fecha se detiene cuando SHA alcanza su mínimo', () => {
    const next = resizeColumnWidths(columns, preferred, 'date', 300);
    expect(next).toEqual({ ...preferred, date: 170, sha: 70 });
    expect(total(next)).toBe(total(preferred));
  });

  it('Mensaje toma espacio de varias columnas derechas sin mover su lado izquierdo', () => {
    const next = resizeColumnWidths(columns, preferred, 'subject', 1000);
    expect(next).toEqual({ graph: 120, subject: 580, author: 70, date: 130, sha: 70 });
    expect(total(next)).toBe(total(preferred));
  });

  it('estrechar Autor devuelve espacio a Fecha manteniendo fijas las columnas anteriores', () => {
    const next = resizeColumnWidths(columns, preferred, 'author', 80);
    expect(next).toEqual({ ...preferred, author: 80, date: 180 });
    expect(total(next)).toBe(total(preferred));
  });

  it('el borde exterior permanece fijo', () => {
    expect(resizeColumnWidths(columns, preferred, 'sha', 120)).toEqual(preferred);
  });

  it('respeta el máximo del grafo si es la única columna visible', () => {
    expect(fitColumnWidths([columns[0]!], () => 500, 1000)).toEqual({ graph: 120 });
  });

  it('no permite el resize cuando el panel obliga a comprimir todos los mínimos', () => {
    const fitted = fitColumnWidths(columns, (key) => preferred[key]!, 200);
    expect(resizeColumnWidths(columns, fitted, 'subject', 300)).toEqual(fitted);
  });
});
