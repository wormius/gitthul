import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Input } from './Input';

describe('Input', () => {
  it('asocia la etiqueta con el campo', () => {
    render(<Input label="Nombre de la rama" />);

    expect(screen.getByLabelText('Nombre de la rama')).toBeInTheDocument();
  });

  it('acepta texto escrito', async () => {
    const user = userEvent.setup();

    render(<Input label="Nombre de la rama" />);
    await user.type(screen.getByLabelText('Nombre de la rama'), 'feature/login');

    expect(screen.getByLabelText('Nombre de la rama')).toHaveValue('feature/login');
  });

  it('marca aria-invalid y asocia el mensaje de error', () => {
    render(<Input label="Correo" error="El correo no es válido" />);

    const input = screen.getByLabelText('Correo');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('El correo no es válido');
  });

  it('el hover no desplaza la caja', () => {
    render(<Input label="Nombre de la rama" />);

    expectNoHoverShift(screen.getByLabelText('Nombre de la rama'));
  });
});
