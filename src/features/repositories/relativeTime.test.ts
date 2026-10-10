import { describe, expect, it } from 'vitest';

import { relativeTime } from './relativeTime';

const format = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });
const NOW = Date.UTC(2026, 6, 28, 12);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('lo de hace un momento no se cuenta en segundos', () => {
    expect(relativeTime(NOW - 5_000, NOW, format)).toBe('ahora');
  });

  it('elige la unidad por magnitud', () => {
    expect(relativeTime(NOW - 40 * MINUTE, NOW, format)).toBe('hace 40 minutos');
    expect(relativeTime(NOW - 5 * HOUR, NOW, format)).toBe('hace 5 horas');
    expect(relativeTime(NOW - 3 * DAY, NOW, format)).toBe('hace 3 días');
    expect(relativeTime(NOW - 20 * DAY, NOW, format)).toBe('hace 3 semanas');
    expect(relativeTime(NOW - 120 * DAY, NOW, format)).toBe('hace 4 meses');
    expect(relativeTime(NOW - 800 * DAY, NOW, format)).toBe('hace 2 años');
  });

  // `numeric: 'auto'` es lo que hace que se diga como se dice, no como se cuenta.
  it('usa la palabra del idioma cuando la hay', () => {
    expect(relativeTime(NOW - 26 * HOUR, NOW, format)).toBe('ayer');
  });

  /*
   * El reloj del sistema puede ir atrasado respecto de lo que se guardó, así que
   * una apertura «en el futuro» es posible y no puede salir como «hace -1 días».
   */
  it('sabe decir el futuro', () => {
    expect(relativeTime(NOW + 3 * DAY, NOW, format)).toBe('dentro de 3 días');
  });
});
