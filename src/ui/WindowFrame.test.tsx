import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { WindowFrame, type ResizeEdge } from './WindowFrame';

const EDGES: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

/*
 * Las asas no tienen rol ni nombre accesible, y es a propósito —redimensionar
 * por teclado lo hace el gestor de ventanas—, así que aquí no hay forma de
 * buscarlas por rol. Se buscan por el borde que declaran, que es el dato que el
 * componente le pasa al puerto y lo único que hay que comprobar de cada una.
 */
function grips(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-edge]')];
}

function gripFor(container: HTMLElement, edge: ResizeEdge) {
  const grip = container.querySelector<HTMLElement>(`[data-edge='${edge}']`);

  if (!grip) throw new Error(`Falta el asa ${edge}`);

  return grip;
}

describe('WindowFrame', () => {
  it('pone las ocho asas, cuatro lados y cuatro esquinas', () => {
    const { container } = render(<WindowFrame enabled onResizeStart={vi.fn()} />);

    expect(grips(container).map((grip) => grip.dataset.edge)).toEqual([...EDGES]);
  });

  it('cada asa redimensiona por su borde', () => {
    const onResizeStart = vi.fn<(edge: ResizeEdge) => void>();
    const { container } = render(<WindowFrame enabled onResizeStart={onResizeStart} />);

    for (const edge of EDGES) fireEvent.mouseDown(gripFor(container, edge), { button: 0 });

    expect(onResizeStart.mock.calls.map(([edge]) => edge)).toEqual([...EDGES]);
  });

  // El botón derecho abre menús; el del medio pega en algunos escritorios. Solo
  // el izquierdo redimensiona, igual que en cualquier borde de ventana.
  it('el botón derecho no redimensiona', () => {
    const onResizeStart = vi.fn();
    const { container } = render(<WindowFrame enabled onResizeStart={onResizeStart} />);

    fireEvent.mouseDown(gripFor(container, 'se'), { button: 2 });

    expect(onResizeStart).not.toHaveBeenCalled();
  });

  it('maximizada no hay asas', () => {
    const { container } = render(<WindowFrame enabled={false} onResizeStart={vi.fn()} />);

    expect(grips(container)).toHaveLength(0);
  });

  it('las asas quedan fuera del árbol de accesibilidad', () => {
    const { container } = render(<WindowFrame enabled onResizeStart={vi.fn()} />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('el hover no desplaza la caja', () => {
    const { container } = render(<WindowFrame enabled onResizeStart={vi.fn()} />);

    expectNoHoverShift(gripFor(container, 'se'));
  });
});
