import { describe, expect, it } from 'vitest';

import { contrastRatio, hexContrastRatio, over, parseHexColor, relativeLuminance } from './color';

describe('parseHexColor', () => {
  it('acepta la forma corta y la larga, y sin alfa lo da por opaco', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHexColor('#C24BD6')).toEqual({ r: 194, g: 75, b: 214, a: 1 });
    expect(parseHexColor('  #0c0c10  ')).toEqual({ r: 12, g: 12, b: 16, a: 1 });
  });

  /*
   * Los fondos de diff llevan alfa a propósito: la selección se pinta por
   * debajo de la línea, así que solo se ve si la línea deja ver a través.
   */
  it('lee el alfa de las formas de cuatro y ocho dígitos', () => {
    expect(parseHexColor('#0f2b2175')).toMatchObject({ r: 15, g: 43, b: 33 });
    expect(parseHexColor('#0f2b2175')?.a).toBeCloseTo(0.459, 2);
    expect(parseHexColor('#000f')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseHexColor('#0000')?.a).toBe(0);
  });

  it('rechaza lo que no es un hexadecimal', () => {
    expect(parseHexColor('var(--accent)')).toBeNull();
    expect(parseHexColor('rgb(0 0 0)')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('#1234567')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });
});

describe('componer sobre un fondo', () => {
  const white = { r: 255, g: 255, b: 255, a: 1 };

  it('un color opaco tapa lo que tiene detrás', () => {
    expect(over({ r: 10, g: 20, b: 30, a: 1 }, white)).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });

  it('uno del todo transparente deja ver solo el fondo', () => {
    expect(over({ r: 10, g: 20, b: 30, a: 0 }, white)).toEqual(white);
  });

  it('a la mitad, la mezcla de los dos', () => {
    expect(over({ r: 0, g: 0, b: 0, a: 0.5 }, white)).toEqual({ r: 128, g: 128, b: 128, a: 1 });
  });
});

describe('contraste', () => {
  it('va de 1 a 21', () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };

    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it('no depende del orden de los argumentos', () => {
    expect(hexContrastRatio('#0c0c10', '#ececf1')).toBeCloseTo(
      hexContrastRatio('#ececf1', '#0c0c10'),
      10,
    );
  });

  it('mide la luminancia según WCAG', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });

  it('avisa cuando le dan algo que no es un color', () => {
    expect(() => hexContrastRatio('#fff', 'papaya')).toThrow(/papaya/);
  });
});
