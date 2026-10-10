import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import type { TabDescriptor } from './Tab';
import { TabStrip } from './TabStrip';

const tabs: readonly TabDescriptor[] = [
  { id: 't1', label: 'Repositorios', closeLabel: 'Cerrar la pestaña Repositorios' },
  {
    id: 't2',
    label: 'gitthul',
    hint: 'rama main',
    closeLabel: 'Cerrar la pestaña gitthul',
  },
  { id: 't3', label: 'linux', hint: 'rama master', closeLabel: 'Cerrar la pestaña linux' },
];

function setup(props: Partial<Parameters<typeof TabStrip>[0]> = {}) {
  const handlers = { onActivate: vi.fn(), onClose: vi.fn(), onReorder: vi.fn() };

  render(<TabStrip label="Pestañas abiertas" tabs={tabs} activeId="t1" {...handlers} {...props} />);

  return handlers;
}

describe('TabStrip', () => {
  it('lista las pestañas y marca la activa', () => {
    setup();

    expect(screen.getByRole('list', { name: 'Pestañas abiertas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Repositorios' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'gitthul rama main' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('activa al pulsar el rótulo', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: 'linux rama master' }));

    expect(handlers.onActivate).toHaveBeenCalledWith('t3');
  });

  it('cierra con la × y con el clic de la rueda', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: 'Cerrar la pestaña gitthul' }));
    expect(handlers.onClose).toHaveBeenCalledWith('t2');

    const tab = screen.getByRole('button', { name: 'linux rama master' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    await user.pointer({ keys: '[MouseMiddle]', target: tab });
    expect(handlers.onClose).toHaveBeenCalledWith('t3');
  });

  it('reordena soltando sobre otra pestaña', () => {
    const handlers = setup();
    const source = screen.getByRole('button', { name: 'linux rama master' }).closest('li');
    const target = screen.getByRole('button', { name: 'Repositorios' }).closest('li');

    if (!source || !target) throw new Error('Faltan las pestañas');

    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(handlers.onReorder).toHaveBeenCalledWith('t3', 0);
  });

  it('la pestaña arrastrada se queda fantasmal en su hueco', async () => {
    setup();

    const tab = screen.getByRole('button', { name: 'linux rama master' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    fireEvent.dragStart(tab);

    // Un cuadro más tarde: durante el manejador, la foto del arrastre aún no está
    // tomada y atenuar aquí atenuaría también lo que viaja con el puntero.
    expect(tab).toHaveAttribute('data-dragging', 'false');
    await waitFor(() => {
      expect(tab).toHaveAttribute('data-dragging', 'true');
    });

    const style = window.getComputedStyle(tab);

    expect(Number(style.opacity)).toBeLessThan(1);
    expect(style.borderStyle).toBe('dashed');

    fireEvent.dragEnd(tab);
    expect(tab).toHaveAttribute('data-dragging', 'false');
  });

  it('soltar sobre sí misma no reordena', () => {
    const handlers = setup();
    const tab = screen.getByRole('button', { name: 'linux rama master' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    fireEvent.dragStart(tab);
    fireEvent.drop(tab);

    expect(handlers.onReorder).not.toHaveBeenCalled();
  });

  it('las flechas recorren la tira sin activar nada', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Repositorios' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'gitthul rama main' })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'linux rama master' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Repositorios' })).toHaveFocus();

    expect(handlers.onActivate).not.toHaveBeenCalled();
  });

  it('solo monta activación y cierre visibles dentro de cada pestaña', () => {
    setup();

    const tab = screen.getByRole('button', { name: 'gitthul rama main' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    expect(tab).toHaveTextContent('gitthulrama main');
    expect(within(tab).getAllByRole('button')).toHaveLength(2);
  });

  it('el hover no desplaza la caja de la pestaña', () => {
    setup();

    const tab = screen.getByRole('button', { name: 'gitthul rama main' }).closest('li');

    if (!tab) throw new Error('Falta la pestaña');

    expectNoHoverShift(tab);
  });
});
