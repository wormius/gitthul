import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { Popover } from './Popover';

function Harness() {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        ref={setAnchor}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        main +3
      </Button>
      <Popover
        open={open}
        anchor={anchor}
        onClose={() => {
          setOpen(false);
        }}
        label="Ramas en a1b2c3d"
      >
        <button type="button">origin/main</button>
      </Popover>
    </>
  );
}

describe('Popover', () => {
  it('se abre anclado y no atrapa el foco de la vista', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'main +3' }));

    expect(screen.getByRole('dialog', { name: 'Ramas en a1b2c3d' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'origin/main' })).toBeInTheDocument();
  });

  it('cierra con Escape y devuelve el foco al anclaje', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    const anchor = screen.getByRole('button', { name: 'main +3' });

    await user.click(anchor);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(anchor).toHaveFocus();
  });

  it('cierra al pulsar fuera', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'main +3' }));
    await user.click(document.body);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
