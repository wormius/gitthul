import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('expone su etiqueta accesible aunque no tenga texto visible', () => {
    render(<IconButton icon={<svg />} aria-label="Cerrar pestaña" />);

    expect(screen.getByRole('button', { name: 'Cerrar pestaña' })).toBeInTheDocument();
  });

  it('responde al clic', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<IconButton icon={<svg />} aria-label="Cerrar pestaña" onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Cerrar pestaña' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('marca aria-pressed cuando actúa como alternador', () => {
    render(<IconButton icon={<svg />} aria-label="Ver archivo" pressed />);

    expect(screen.getByRole('button', { name: 'Ver archivo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('el hover no desplaza la caja', () => {
    render(<IconButton icon={<svg />} aria-label="Cerrar pestaña" />);

    expectNoHoverShift(screen.getByRole('button', { name: 'Cerrar pestaña' }));
  });
});
