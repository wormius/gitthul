import { fireEvent } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Prueba compartida de la invariante 1: el hover jamás desplaza la interfaz,
 * ni un píxel. La lleva cada primitivo de la galería.
 *
 * jsdom no calcula layout real — `getBoundingClientRect` siempre da ceros —
 * así que aquí no puede detectar un cambio de caja por medición directa. Se
 * deja la comparación tal como la pide el plan porque es la que serviría si
 * el entorno de pruebas ganara layout real más adelante (por ejemplo, un
 * runner sobre un navegador de verdad); mientras tanto, la disciplina real la
 * impone la regla de `literalColors.test.ts` y la revisión de que el CSS de
 * cada componente solo toca `background-color`, `color`, `outline` u
 * `opacity` en `:hover`, nunca `padding`, `margin`, `border-width`,
 * `font-size` ni `font-weight`.
 */
export function expectNoHoverShift(element: HTMLElement) {
  const before = element.getBoundingClientRect();

  fireEvent.mouseEnter(element);

  const during = element.getBoundingClientRect();

  expect(during.width).toBe(before.width);
  expect(during.height).toBe(before.height);
  expect(during.top).toBe(before.top);
  expect(during.left).toBe(before.left);

  fireEvent.mouseLeave(element);

  const after = element.getBoundingClientRect();

  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
}
