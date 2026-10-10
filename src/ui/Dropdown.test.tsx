import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Dropdown } from './Dropdown';
import type { MenuEntry } from './menuUtils';

const items: MenuEntry[] = [
  { key: 'name', label: 'Por nombre', checked: true, onSelect: vi.fn() },
  { key: 'opened', label: 'Por última apertura', checked: false, onSelect: vi.fn() },
];

describe('Dropdown', () => {
  it('abre y cierra el menú desde el disparador', async () => {
    const user = userEvent.setup();

    render(<Dropdown label="Ordenar" items={items} />);

    const trigger = screen.getByRole('button', { name: 'Ordenar' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Ordenar' })).toBeInTheDocument();

    await user.click(trigger);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('marca los ítems de alternar con su estado', async () => {
    const user = userEvent.setup();

    render(<Dropdown label="Ordenar" items={items} />);
    await user.click(screen.getByRole('button', { name: 'Ordenar' }));

    expect(screen.getByRole('menuitemcheckbox', { name: 'Por nombre' })).toBeChecked();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Por última apertura' })).not.toBeChecked();
  });

  it('devuelve el foco al disparador al elegir', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<Dropdown label="Ordenar" items={[{ key: 'name', label: 'Por nombre', onSelect }]} />);

    const trigger = screen.getByRole('button', { name: 'Ordenar' });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Por nombre' }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });

  it('abre con la flecha abajo desde el teclado', async () => {
    const user = userEvent.setup();

    render(<Dropdown label="Ordenar" items={items} />);

    screen.getByRole('button', { name: 'Ordenar' }).focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Dropdown label="Ordenar" items={items} />);

    expectNoHoverShift(screen.getByRole('button', { name: 'Ordenar' }));
  });
});
