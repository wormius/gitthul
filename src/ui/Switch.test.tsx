import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Switch } from './Switch';

describe('Switch', () => {
  it('alterna de estado al hacer clic', async () => {
    const user = userEvent.setup();

    render(<Switch label="Traer avatares de GitHub" />);
    const toggle = screen.getByRole('switch', { name: 'Traer avatares de GitHub' });

    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
  });

  it('el hover no desplaza la caja', () => {
    render(<Switch label="Traer avatares de GitHub" />);

    expectNoHoverShift(screen.getByRole('switch', { name: 'Traer avatares de GitHub' }));
  });
});
