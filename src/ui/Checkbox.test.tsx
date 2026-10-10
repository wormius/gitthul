import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('asocia la etiqueta y alterna al hacer clic', async () => {
    const user = userEvent.setup();

    render(<Checkbox label="Ver archivos ignorados" />);
    const checkbox = screen.getByRole('checkbox', { name: 'Ver archivos ignorados' });

    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it('el hover no desplaza la caja', () => {
    render(<Checkbox label="Ver archivos ignorados" />);

    expectNoHoverShift(screen.getByRole('checkbox', { name: 'Ver archivos ignorados' }));
  });
});
