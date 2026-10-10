import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Button } from './Button';
import { Toolbar } from './Toolbar';

describe('Toolbar', () => {
  it('agrupa sus controles bajo un rol de barra de herramientas', () => {
    render(
      <Toolbar label="Acciones de GitWorking">
        <Button>Fetch</Button>
        <Button>Pull</Button>
      </Toolbar>,
    );

    const toolbar = screen.getByRole('toolbar', { name: 'Acciones de GitWorking' });

    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Fetch' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Pull' }));
  });

  it('saca las acciones secundarias por el desplegable del final', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(
      <Toolbar
        label="Acciones de GitWorking"
        overflow={{
          label: 'Más acciones de GitWorking',
          items: [{ key: 'prune', label: 'Limpiar ramas remotas borradas', onSelect }],
        }}
      >
        <Button>Fetch</Button>
      </Toolbar>,
    );

    await user.click(screen.getByRole('button', { name: 'Más acciones de GitWorking' }));
    await user.click(screen.getByRole('menuitem', { name: 'Limpiar ramas remotas borradas' }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('el hover no desplaza la caja', () => {
    render(
      <Toolbar label="Acciones de GitWorking">
        <Button>Fetch</Button>
      </Toolbar>,
    );

    expectNoHoverShift(screen.getByRole('toolbar'));
  });
});
