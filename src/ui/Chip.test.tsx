import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Chip } from './Chip';

describe('Chip', () => {
  it('avisa al seleccionarla', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<Chip onSelect={onSelect}>main</Chip>);
    await user.click(screen.getByRole('button', { name: 'main' }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('muestra el botón de quitar solo si se pide, con su etiqueta accesible', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();

    render(
      <Chip onRemove={onRemove} removeLabel="Quitar filtro main">
        main
      </Chip>,
    );
    await user.click(screen.getByRole('button', { name: 'Quitar filtro main' }));

    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('no ofrece quitar cuando no se pasa onRemove', () => {
    render(<Chip>main</Chip>);

    expect(screen.queryByRole('button', { name: /quitar/i })).not.toBeInTheDocument();
  });

  it('sin nada que pulsar no deja ningún botón en el orden de tabulación', () => {
    render(<Chip>Trabajo</Chip>);

    expect(screen.getByText('Trabajo')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('el hover no desplaza la caja', () => {
    render(
      <Chip onSelect={vi.fn()} onRemove={vi.fn()} removeLabel="Quitar filtro main">
        main
      </Chip>,
    );

    expectNoHoverShift(screen.getByRole('button', { name: 'main' }));
  });
});
