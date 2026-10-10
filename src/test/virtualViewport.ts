import { afterEach, beforeEach } from 'vitest';

/**
 * Da alto y ancho a los elementos durante una suite de pruebas.
 *
 * jsdom no calcula diseño: `offsetHeight` siempre vale cero, y la
 * virtualización de TanStack usa justamente ese valor para decidir qué filas
 * caben. Con cero no cabe ninguna y la lista se pinta vacía, así que sin esto no
 * hay forma de probar el comportamiento de `VirtualList`, `Tree` ni `DataGrid`.
 *
 * Se instala solo donde hace falta y no en `setup.ts`: fingir que todo elemento
 * mide 800 × 600 cambiaría la colocación de los flotantes en las pruebas de
 * F0.5, que sí dependen de las medidas reales.
 */
export function useVirtualViewport(height = 600, width = 800) {
  const measures = [
    ['offsetHeight', height],
    ['offsetWidth', width],
  ] as const;

  const originals = new Map<string, PropertyDescriptor | undefined>();

  beforeEach(() => {
    for (const [name, value] of measures) {
      originals.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));

      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get: () => value,
      });
    }
  });

  afterEach(() => {
    for (const [name] of measures) {
      const original = originals.get(name);

      if (original) Object.defineProperty(HTMLElement.prototype, name, original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });
}
