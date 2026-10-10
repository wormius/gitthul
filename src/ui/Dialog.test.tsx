import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Dialog } from './Dialog';

function renderDialog(onClose = vi.fn()) {
  return render(
    <Dialog
      open
      onClose={onClose}
      title="Borrar la rama dev"
      description="Se pierden 3 commits que no están en main."
      closeLabel="Cerrar"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary">Borrar dev</Button>
        </>
      }
    >
      <p>La rama dev no está fusionada en main.</p>
    </Dialog>,
  );
}

describe('Dialog', () => {
  it('presenta título y qué se pierde, y es modal', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Borrar la rama dev' });

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Se pierden 3 commits que no están en main.')).toBeInTheDocument();
  });

  /*
   * Los rótulos del pie nombran su objeto —«Dejar *Personales* donde está»— así
   * que su ancho depende de cómo se llame lo que se va a borrar. Sin envolver, el
   * par se salía del panel y el botón de cancelar salía cortado a media palabra:
   * la peor forma posible de ofrecer una salida. jsdom no calcula diseño, así que
   * lo que se comprueba es la regla que lo evita.
   */
  it('el pie envuelve cuando sus botones no caben en una línea', () => {
    renderDialog();

    const footer = screen.getByRole('button', { name: 'Borrar dev' }).parentElement;

    if (!footer) throw new Error('El pie no tiene caja');

    expect(window.getComputedStyle(footer).flexWrap).toBe('wrap');
  });

  it('lleva el foco dentro al abrir', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus();
  });

  it('respeta el control que pide foco inicial', () => {
    render(
      <Dialog open onClose={vi.fn()} title="Crear rama" closeLabel="Cerrar">
        <label htmlFor="branch-name">Nombre</label>
        <input id="branch-name" autoFocus />
      </Dialog>,
    );

    expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveFocus();
  });

  it('cierra con Escape y con el botón de cerrar', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderDialog(onClose);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('atrapa el foco: del último control vuelve al primero', async () => {
    const user = userEvent.setup();

    renderDialog();

    const close = screen.getByRole('button', { name: 'Cerrar' });

    screen.getByRole('button', { name: 'Borrar dev' }).focus();
    await user.tab();

    expect(close).toHaveFocus();

    await user.tab({ shift: true });

    expect(screen.getByRole('button', { name: 'Borrar dev' })).toHaveFocus();
  });

  it('devuelve el foco a lo que lo tenía al cerrarse', () => {
    const opener = document.createElement('button');

    document.body.append(opener);
    opener.focus();

    const { rerender } = render(
      <Dialog open onClose={vi.fn()} title="Fusionar dev dentro de main" closeLabel="Cerrar" />,
    );

    expect(opener).not.toHaveFocus();

    rerender(
      <Dialog
        open={false}
        onClose={vi.fn()}
        title="Fusionar dev dentro de main"
        closeLabel="Cerrar"
      />,
    );

    expect(opener).toHaveFocus();

    opener.remove();
  });

  it('no se pinta cuando está cerrado', () => {
    render(<Dialog open={false} onClose={vi.fn()} title="Nada" closeLabel="Cerrar" />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
