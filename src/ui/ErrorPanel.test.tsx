import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { ErrorPanel } from './ErrorPanel';

const output = '! [rejected] main -> main (fetch first)\nerror: failed to push some refs';

describe('ErrorPanel', () => {
  it('cuenta qué pasó, por qué, y guarda la salida cruda plegada', () => {
    render(
      <ErrorPanel
        title="No se pudo publicar main"
        cause="origin/main tiene 2 commits que tú no tienes."
        output={output}
        outputLabel="Salida de git"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo publicar main');
    expect(screen.getByText('origin/main tiene 2 commits que tú no tienes.')).toBeInTheDocument();

    const details = screen.getByText('Salida de git').closest('details');

    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText(/failed to push some refs/)).toBeInTheDocument();
  });

  it('ofrece el arreglo más probable como acción principal', async () => {
    const onFetch = vi.fn();
    const user = userEvent.setup();

    render(
      <ErrorPanel
        title="No se pudo publicar main"
        fixes={[
          {
            key: 'fetch',
            label: 'Traer origin/main y reintentar',
            onSelect: onFetch,
            primary: true,
          },
          { key: 'force', label: 'Forzar la publicación de main', onSelect: vi.fn() },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Traer origin/main y reintentar' }));

    expect(onFetch).toHaveBeenCalledOnce();
  });

  it('admite detalle propio del caso', () => {
    render(
      <ErrorPanel title="No se pudo publicar main">
        <p>a1b2c3d · Ada Lovelace</p>
      </ErrorPanel>,
    );

    expect(screen.getByText('a1b2c3d · Ada Lovelace')).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<ErrorPanel title="No se pudo publicar main" />);

    expectNoHoverShift(screen.getByRole('alert'));
  });
});
