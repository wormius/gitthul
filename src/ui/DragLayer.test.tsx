import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { DragLayer } from './DragLayer';
import { useDragSource, useDropTarget, type DropVerdict } from './dragLayerUtils';

/**
 * El arrastre se dispara evento a evento: `userEvent` no lo simula y jsdom no
 * implementa `DataTransfer`. Lo que se ejercita aquí es exactamente la lógica
 * que corre de verdad, porque la capa decide con su propia sesión y usa el
 * transporte del navegador solo para que el sistema pinte el gesto.
 */

interface DemoRef {
  kind: 'branch' | 'tag';
  name: string;
}

function isRef(payload: unknown): payload is DemoRef {
  return typeof payload === 'object' && payload !== null && 'kind' in payload;
}

/** Lo mínimo del transporte del navegador, con la entrega de la copia espiada. */
function transfer() {
  return { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '' };
}

function Source({ item }: { item: DemoRef }) {
  const drag = useDragSource({ payload: item, text: item.name });

  return <span {...drag}>{item.name}</span>;
}

function Target({
  name,
  accepts,
  onDrop,
}: {
  name: string;
  accepts: (payload: DemoRef) => DropVerdict | null;
  onDrop?: (payload: DemoRef) => void;
}) {
  const drop = useDropTarget({
    accepts: (payload) => (isRef(payload) ? accepts(payload) : null),
    onDrop: (payload) => {
      if (isRef(payload)) onDrop?.(payload);
    },
  });

  return <div {...drop}>{name}</div>;
}

function renderLayer(onDrop?: (payload: DemoRef) => void) {
  return render(
    <DragLayer>
      <Source item={{ kind: 'branch', name: 'dev' }} />
      <Target name="main" accepts={() => 'valid'} onDrop={onDrop} />
      <Target name="Worktrees" accepts={(ref) => (ref.kind === 'branch' ? 'valid' : 'invalid')} />
      <Target name="Fondo del grafo" accepts={() => null} />
    </DragLayer>,
  );
}

const source = () => screen.getByText('dev');
const target = (name: string) => screen.getByText(name);

describe('DragLayer', () => {
  /*
   * La lección de WebKit, convertida en prueba: la foto que viaja con el puntero
   * se toma justo después del `dragstart`, así que nada se pinta en ese
   * instante. El único aviso que llega dentro del bucle del arrastre es
   * `dragover`, y de él cuelgan el fantasma y el aviso del destino apuntado.
   */
  it('no enciende nada hasta el primer `dragover`', () => {
    renderLayer();

    fireEvent.dragStart(source());

    expect(source()).not.toHaveAttribute('data-ghost');
    expect(target('main')).not.toHaveAttribute('data-drop');

    fireEvent.dragOver(target('main'));

    expect(source()).toHaveAttribute('data-ghost');
    expect(target('main')).toHaveAttribute('data-drop', 'valid');
  });

  it('marca solo el destino bajo el puntero', () => {
    renderLayer();

    fireEvent.dragStart(source());
    fireEvent.dragOver(target('main'));

    expect(target('main')).toHaveAttribute('data-drop', 'valid');
    expect(target('main')).toHaveAttribute('data-over');
    // Aunque también aceptaría la rama, permanece neutro hasta apuntarlo.
    expect(target('Worktrees')).not.toHaveAttribute('data-drop');
    expect(target('Worktrees')).not.toHaveAttribute('data-over');
    // No es destino de nada: ni se resalta ni recibe.
    expect(target('Fondo del grafo')).not.toHaveAttribute('data-drop');
  });

  /* Un destino que no acepta lo dice, en vez de dejar que no pase nada. */
  it('marca como inválido el destino que no acepta lo que viaja', () => {
    render(
      <DragLayer>
        <Source item={{ kind: 'tag', name: 'v0.1.0' }} />
        <Target name="Worktrees" accepts={(ref) => (ref.kind === 'branch' ? 'valid' : 'invalid')} />
      </DragLayer>,
    );

    fireEvent.dragStart(screen.getByText('v0.1.0'));
    fireEvent.dragOver(target('Worktrees'));

    expect(target('Worktrees')).toHaveAttribute('data-drop', 'invalid');
  });

  it('entrega lo que viaja solo al destino válido', () => {
    const onDrop = vi.fn();

    renderLayer(onDrop);

    fireEvent.dragStart(source());
    fireEvent.dragOver(target('main'));
    fireEvent.drop(target('main'));

    expect(onDrop).toHaveBeenCalledWith({ kind: 'branch', name: 'dev' });
  });

  it('no entrega nada al que no es destino', () => {
    const onDrop = vi.fn();

    renderLayer(onDrop);

    fireEvent.dragStart(source());
    fireEvent.dragOver(target('Fondo del grafo'));
    fireEvent.drop(target('Fondo del grafo'));

    expect(onDrop).not.toHaveBeenCalled();
  });

  /* El resalte cambia de sitio con el puntero, y el que se deja atrás se apaga. */
  it('mueve el resalte de un destino al siguiente', () => {
    renderLayer();

    fireEvent.dragStart(source());
    fireEvent.dragOver(target('main'));
    fireEvent.dragOver(target('Worktrees'));
    fireEvent.dragLeave(target('main'));

    expect(target('main')).not.toHaveAttribute('data-drop');
    expect(target('main')).not.toHaveAttribute('data-over');
    expect(target('Worktrees')).toHaveAttribute('data-drop', 'valid');
    expect(target('Worktrees')).toHaveAttribute('data-over');
  });

  it('apaga la sesión con el `dragend`, que es el único aviso seguro', () => {
    renderLayer();

    fireEvent.dragStart(source());
    fireEvent.dragOver(target('main'));
    fireEvent.dragEnd(source());

    expect(source()).not.toHaveAttribute('data-ghost');
    expect(target('main')).not.toHaveAttribute('data-drop');
    expect(target('main')).not.toHaveAttribute('data-over');
  });

  /* Lo que viaja con el puntero es una copia: atenuar el original la borraría. */
  it('manda al puntero una copia del origen, nunca el original', () => {
    const data = transfer();

    renderLayer();

    // Se guarda antes de arrastrar: a partir de aquí hay dos «dev» en el
    // documento, el original y la copia que espera fuera de la pantalla.
    const original = source();

    fireEvent.dragStart(original, { dataTransfer: data });

    expect(data.setData).toHaveBeenCalledWith('text/plain', 'dev');
    expect(data.setDragImage).toHaveBeenCalledOnce();

    const [copy] = data.setDragImage.mock.calls[0] as [HTMLElement, number, number];

    expect(copy).not.toBe(original);
    expect(copy).toHaveTextContent('dev');
  });

  it('no desplaza la interfaz con el hover', () => {
    const { container } = renderLayer();

    expectNoHoverShift(container);
    expectNoHoverShift(target('main'));
  });
});
