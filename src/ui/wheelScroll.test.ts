import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDirectWheel } from './wheelScroll';

/**
 * jsdom no tiene diseño: `scrollHeight` y compañía se definen a mano, igual que
 * en las pruebas de `SyncScroll`.
 */
function scrollable(values: Record<string, number> = {}): HTMLElement {
  const element = document.createElement('div');
  const sizes = {
    scrollHeight: 1000,
    clientHeight: 300,
    scrollWidth: 300,
    clientWidth: 300,
    ...values,
  };

  for (const [name, value] of Object.entries(sizes)) {
    Object.defineProperty(element, name, { value, writable: true, configurable: true });
  }

  element.scrollTop = 0;
  element.scrollLeft = 0;
  document.body.appendChild(element);

  return element;
}

function wheel(element: HTMLElement, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });

  element.dispatchEvent(event);

  return event;
}

describe('useDirectWheel', () => {
  it('convierte la rueda en desplazamiento, uno a uno', () => {
    const element = scrollable();

    renderHook(() => {
      useDirectWheel(element);
    });

    const event = wheel(element, { deltaY: 120 });

    expect(element.scrollTop).toBe(120);
    expect(event.defaultPrevented).toBe(true);
  });

  it('cuatro vueltas seguidas avanzan las cuatro', () => {
    const element = scrollable();

    renderHook(() => {
      useDirectWheel(element);
    });

    // Es lo que el WebKit de la ventana no hacía: con su animación propia, una
    // ráfaga rápida acababa avanzando menos que una lenta.
    for (let i = 0; i < 4; i += 1) wheel(element, { deltaY: 50 });

    expect(element.scrollTop).toBe(200);
  });

  it('en líneas y en páginas también, con su factor', () => {
    const element = scrollable();

    renderHook(() => {
      useDirectWheel(element);
    });

    wheel(element, { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(element.scrollTop).toBe(48);

    element.scrollTop = 0;
    wheel(element, { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expect(element.scrollTop).toBe(300);
  });

  it('el zoom del navegador no se toca', () => {
    const element = scrollable();

    renderHook(() => {
      useDirectWheel(element);
    });

    const event = wheel(element, { deltaY: 120, ctrlKey: true });

    expect(element.scrollTop).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('en el borde el evento sigue su camino, para el contenedor de fuera', () => {
    const element = scrollable();

    renderHook(() => {
      useDirectWheel(element);
    });

    const event = wheel(element, { deltaY: -50 });

    expect(element.scrollTop).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('un contenedor que no puede desplazarse no se queda el evento', () => {
    const element = scrollable({ scrollHeight: 300, clientHeight: 300 });

    renderHook(() => {
      useDirectWheel(element);
    });

    const event = wheel(element, { deltaY: 120 });

    expect(event.defaultPrevented).toBe(false);
  });
});
