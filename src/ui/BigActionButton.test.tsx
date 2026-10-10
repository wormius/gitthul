import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { BigActionButton } from './BigActionButton';

describe('BigActionButton', () => {
  it('muestra su etiqueta y responde al clic', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<BigActionButton icon={<svg />} label="Clonar" onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Clonar' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('el hover no desplaza la caja', () => {
    render(<BigActionButton icon={<svg />} label="Clonar" />);

    expectNoHoverShift(screen.getByRole('button', { name: 'Clonar' }));
  });
});
