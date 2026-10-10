import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('asocia la etiqueta con el campo', () => {
    render(<Textarea label="Detalle del commit" />);

    expect(screen.getByLabelText('Detalle del commit')).toBeInTheDocument();
  });

  it('acepta texto multilínea', async () => {
    const user = userEvent.setup();

    render(<Textarea label="Detalle del commit" />);
    await user.type(screen.getByLabelText('Detalle del commit'), 'línea 1{enter}línea 2');

    expect(screen.getByLabelText('Detalle del commit')).toHaveValue('línea 1\nlínea 2');
  });

  it('el hover no desplaza la caja', () => {
    render(<Textarea label="Detalle del commit" />);

    expectNoHoverShift(screen.getByLabelText('Detalle del commit'));
  });
});
