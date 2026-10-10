import { describe, expect, it } from 'vitest';

import { markerBand, MINIMUM_BAND, seekPosition, viewportBand } from './markerScrollbar';

const marker = (from: number, to?: number) =>
  ({ id: 'm', from, ...(to === undefined ? {} : { to }), tone: 'added' }) as const;

describe('markerBand', () => {
  it('reparte la marca en porcentaje del total', () => {
    expect(markerBand(marker(25, 50), 100)).toEqual({ top: 25, height: 25 });
  });

  it('una marca de un punto se estira hasta poder verse', () => {
    expect(markerBand(marker(10), 100)).toEqual({ top: 10, height: MINIMUM_BAND });
  });

  it('un cambio de una línea entre cien mil sigue siendo visible', () => {
    const band = markerBand(marker(50_000, 50_001), 100_000);

    expect(band.height).toBe(MINIMUM_BAND);
    expect(band.top).toBeCloseTo(50, 1);
  });

  it('la marca del final no se sale de la pista', () => {
    const band = markerBand(marker(100), 100);

    expect(band.top + band.height).toBeCloseTo(100, 5);
  });

  it('recorta lo que se sale por cualquier lado', () => {
    expect(markerBand(marker(-40, 50), 100)).toEqual({ top: 0, height: 50 });
    expect(markerBand(marker(50, 400), 100)).toEqual({ top: 50, height: 50 });
  });

  it('acepta un rango del revés', () => {
    expect(markerBand(marker(60, 20), 100)).toEqual({ top: 20, height: 40 });
  });

  it('un documento sin medir deja la marca al principio', () => {
    expect(markerBand(marker(5, 9), 0)).toEqual({ top: 0, height: MINIMUM_BAND });
  });
});

describe('viewportBand', () => {
  it('describe la ventana visible como una banda más', () => {
    expect(viewportBand(200, 400, 1000)).toEqual({ top: 20, height: 20 });
  });
});

describe('seekPosition', () => {
  it('lleva el punto pulsado a su posición del documento', () => {
    expect(seekPosition(150, 300, 1000)).toBe(500);
  });

  it('centra la ventana en el punto pulsado', () => {
    expect(seekPosition(150, 300, 1000, 200)).toBe(400);
  });

  it('no se pasa de los extremos', () => {
    expect(seekPosition(-20, 300, 1000, 200)).toBe(0);
    expect(seekPosition(999, 300, 1000, 200)).toBe(800);
  });

  it('sin pista ni total no hay a dónde ir', () => {
    expect(seekPosition(10, 0, 1000)).toBe(0);
    expect(seekPosition(10, 300, 0)).toBe(0);
  });
});
