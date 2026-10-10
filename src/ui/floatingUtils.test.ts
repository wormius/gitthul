import { describe, expect, it } from 'vitest';

import { anchorRect, placeFloating, type FloatingRect } from './floatingUtils';

/*
 * La verificación de F0.5: los flotantes se posicionan bien contra los bordes
 * de la ventana. Aquí se mide la aritmética; que además no desplacen el flujo
 * lo garantiza la capa fija del portal, y lo comprueba cada primitivo.
 */

const viewport = { width: 1000, height: 700 };
const menu = { width: 200, height: 120 };

function rect(x: number, y: number, width = 100, height = 24): FloatingRect {
  return { x, y, width, height };
}

describe('placeFloating', () => {
  it('cuelga por debajo del anclaje cuando hay sitio', () => {
    const placement = placeFloating({ anchor: rect(100, 100), floating: menu, viewport, gap: 4 });

    expect(placement.side).toBe('bottom');
    expect(placement.y).toBe(128);
    expect(placement.x).toBe(100);
  });

  it('voltea al lado opuesto cuando el pedido no cabe', () => {
    const placement = placeFloating({ anchor: rect(100, 640), floating: menu, viewport, gap: 4 });

    expect(placement.side).toBe('top');
    expect(placement.y).toBe(516);
  });

  it('se queda en el lado pedido si el opuesto tampoco cabe mejor', () => {
    const tall = { width: 200, height: 690 };
    const placement = placeFloating({ anchor: rect(100, 200), floating: tall, viewport });

    expect(placement.side).toBe('bottom');
    expect(placement.y).toBe(8);
  });

  it('recorta contra el borde derecho sin salirse', () => {
    const placement = placeFloating({ anchor: rect(950, 100), floating: menu, viewport });

    expect(placement.x).toBe(viewport.width - menu.width - 8);
    expect(placement.x + menu.width).toBeLessThanOrEqual(viewport.width);
  });

  it('recorta contra el borde izquierdo sin salirse', () => {
    const placement = placeFloating({
      anchor: rect(4, 100),
      floating: menu,
      viewport,
      align: 'end',
    });

    expect(placement.x).toBe(8);
  });

  it('centra y alinea al final sobre el anclaje', () => {
    const centered = placeFloating({
      anchor: rect(400, 100),
      floating: menu,
      viewport,
      align: 'center',
    });
    const ended = placeFloating({
      anchor: rect(400, 100),
      floating: menu,
      viewport,
      align: 'end',
    });

    expect(centered.x).toBe(350);
    expect(ended.x).toBe(300);
  });

  it('abre los submenús a la derecha y los voltea contra el borde', () => {
    const roomy = placeFloating({
      anchor: rect(400, 100),
      floating: menu,
      viewport,
      side: 'right',
    });
    const tight = placeFloating({
      anchor: rect(880, 100),
      floating: menu,
      viewport,
      side: 'right',
    });

    expect(roomy.side).toBe('right');
    expect(roomy.x).toBe(504);
    expect(tight.side).toBe('left');
    expect(tight.x).toBe(676);
  });

  it('coloca un menú contextual pedido en la esquina inferior derecha', () => {
    const placement = placeFloating({
      anchor: anchorRect({ x: 995, y: 695 }),
      floating: menu,
      viewport,
    });

    expect(placement.side).toBe('top');
    expect(placement.x + menu.width).toBeLessThanOrEqual(viewport.width);
    expect(placement.y + menu.height).toBeLessThanOrEqual(viewport.height);
  });
});

describe('anchorRect', () => {
  it('trata un punto como un rectángulo sin tamaño', () => {
    expect(anchorRect({ x: 12, y: 30 })).toEqual({ x: 12, y: 30, width: 0, height: 0 });
  });

  it('lee la caja de un elemento', () => {
    const element = document.createElement('div');

    document.body.append(element);

    expect(anchorRect(element)).toEqual({ x: 0, y: 0, width: 0, height: 0 });

    element.remove();
  });
});
