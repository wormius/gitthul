import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Heatmap } from './Heatmap';
import type { HeatmapDay } from './heatmapUtils';

const days: HeatmapDay[] = [
  { date: '2026-07-20', value: 2 },
  { date: '2026-07-24', value: 9 },
];

function renderHeatmap(props: Partial<Parameters<typeof Heatmap>[0]> = {}) {
  return render(
    <Heatmap
      days={days}
      label="Actividad de gitthul en el último año"
      end="2026-07-26"
      weeks={4}
      {...props}
    />,
  );
}

const figure = () => screen.getByRole('img', { name: 'Actividad de gitthul en el último año' });

describe('Heatmap', () => {
  it('se anuncia como una sola imagen con su descripción', () => {
    renderHeatmap();

    expect(figure()).toBeInTheDocument();
  });

  it('pinta una columna por semana y siete celdas en cada una', () => {
    renderHeatmap();

    expect(figure().children).toHaveLength(4);

    for (const week of figure().children) expect(week.children).toHaveLength(7);
  });

  it('cada día lleva su nivel como color de la escala, nunca un literal', () => {
    renderHeatmap();

    const levels = [...figure().querySelectorAll('[style*="--heat-"]')].map((cell) =>
      cell.getAttribute('style'),
    );

    expect(levels.length).toBeGreaterThan(0);
    expect(levels.every((style) => /var\(--heat-[0-4]\)/.test(style ?? ''))).toBe(true);
  });

  it('describe cada día para quien pase el puntero', () => {
    renderHeatmap({
      describeDay: (cell) => `${cell.date}: ${String(cell.value)} commits`,
    });

    expect(figure().querySelector('[title="2026-07-24: 9 commits"]')).not.toBeNull();
  });

  it('la leyenda enseña la escala completa', () => {
    renderHeatmap({ legend: { lessLabel: 'Menos', moreLabel: 'Más' } });

    expect(screen.getByText('Menos')).toBeInTheDocument();
    expect(screen.getByText('Más')).toBeInTheDocument();
  });

  it('recortar semanas no toca la más reciente', () => {
    const { rerender } = renderHeatmap({ weeks: 8 });

    const lastWeekBefore = figure().lastElementChild?.innerHTML;

    rerender(
      <Heatmap
        days={days}
        label="Actividad de gitthul en el último año"
        end="2026-07-26"
        weeks={2}
      />,
    );

    expect(figure().children).toHaveLength(2);
    expect(figure().lastElementChild?.innerHTML).toBe(lastWeekBefore);
  });

  it('ancla el calendario completo a la derecha sin depender de mediciones del navegador', () => {
    const { rerender } = renderHeatmap({ weeks: 53 });
    const clip = figure().parentElement as HTMLElement;

    expect(getComputedStyle(clip).display).toBe('flex');
    expect(getComputedStyle(clip).justifyContent).toBe('flex-end');
    expect(getComputedStyle(clip).overflow).toBe('hidden');
    expect(getComputedStyle(clip).direction).toBe('ltr');
    expect(getComputedStyle(figure()).flexShrink).toBe('0');
    expect(figure().style.getPropertyValue('--heat-weeks')).toBe('53');

    rerender(<Heatmap days={days} label="Actividad de gitthul en el último año" weeks={8} />);
    expect(figure().style.getPropertyValue('--heat-weeks')).toBe('8');
  });

  it('reparte el ancho sobrante entre semanas y conserva cuadrados', () => {
    renderHeatmap();

    const week = figure().firstElementChild as HTMLElement;
    const cell = week.firstElementChild as HTMLElement;

    expect(getComputedStyle(figure()).display).toBe('grid');
    expect(getComputedStyle(figure()).minWidth).toBe('100%');
    expect(getComputedStyle(figure()).gridTemplateColumns).toBe(
      'repeat(var(--heat-weeks), minmax(0, 1fr))',
    );
    expect(getComputedStyle(cell).aspectRatio).toBe('1');
  });

  it('el hover no desplaza la caja', () => {
    renderHeatmap();

    expectNoHoverShift(figure());
  });
});
