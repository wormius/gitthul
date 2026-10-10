import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Button } from './Button';

describe('Button', () => {
  it('muestra su etiqueta y responde al clic', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<Button onClick={onClick}>Fusionar</Button>);
    await user.click(screen.getByRole('button', { name: 'Fusionar' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('no responde al clic cuando está deshabilitado', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button onClick={onClick} disabled>
        Fusionar
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Fusionar' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('el hover no desplaza la caja', () => {
    render(<Button>Fusionar</Button>);

    expectNoHoverShift(screen.getByRole('button', { name: 'Fusionar' }));
  });
});
