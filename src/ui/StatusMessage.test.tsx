import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { StatusMessage } from './StatusMessage';

describe('StatusMessage', () => {
  it('anuncia el resultado sin interrumpir', () => {
    render(
      <StatusMessage
        message="Traído dev dentro de main: 3 commits"
        detail="usó rebase porque no habías publicado"
      />,
    );

    const status = screen.getByRole('status');

    expect(status).toHaveTextContent('Traído dev dentro de main: 3 commits');
    expect(status).toHaveTextContent('usó rebase porque no habías publicado');
  });

  it('el fallo de una operación sí interrumpe', () => {
    render(<StatusMessage tone="danger" message="Push de main rechazado" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Push de main rechazado');
  });

  // El indicador de carga queda fuera del árbol accesible: la región ya se
  // anuncia entera y una zona viva dentro de otra habla dos veces.
  it('mientras corre muestra el indicador sin duplicar la región', () => {
    render(<StatusMessage message="Trayendo de origin" busy busyLabel="Trayendo de origin" />);

    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('se puede descartar', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(
      <StatusMessage
        message="Pestaña gitthul cerrada"
        onDismiss={onDismiss}
        dismissLabel="Descartar el mensaje"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Descartar el mensaje' }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('el hover no desplaza la caja', () => {
    render(<StatusMessage message="De vuelta en Repositorios" />);

    expectNoHoverShift(screen.getByRole('status'));
  });
});
