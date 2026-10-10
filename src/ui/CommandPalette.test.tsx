import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CommandPalette, type CommandGroup } from './CommandPalette';

const onOpenRepo = vi.fn();
const onCheckout = vi.fn();

const groups: CommandGroup[] = [
  {
    key: 'repos',
    label: 'Repositorios',
    items: [
      { key: 'gitthul', label: 'gitthul', description: '~/Espacios/gitthul', onSelect: onOpenRepo },
    ],
  },
  {
    key: 'branches',
    label: 'Ramas',
    items: [
      { key: 'main', label: 'Checkout de main', onSelect: onCheckout },
      { key: 'dev', label: 'Checkout de dev', onSelect: vi.fn() },
    ],
  },
];

function Harness({ results = groups }: { results?: CommandGroup[] }) {
  const [query, setQuery] = useState('');

  return (
    <CommandPalette
      open
      onClose={vi.fn()}
      label="Búsqueda global"
      searchLabel="Buscar"
      placeholder="Buscar repos, ramas, commits…"
      query={query}
      onQueryChange={setQuery}
      groups={results}
      emptyLabel="Sin resultados"
      emptyDescription="Prueba con el nombre de una rama."
    />
  );
}

describe('CommandPalette', () => {
  it('agrupa los resultados por tipo', () => {
    render(<Harness />);

    expect(screen.getByRole('group', { name: 'Repositorios' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Ramas' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('arranca con el foco en la caja y escribe en ella', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    const search = screen.getByRole('combobox', { name: 'Buscar' });

    expect(search).toHaveFocus();

    await user.type(search, 'main');

    expect(search).toHaveValue('main');
  });

  it('recorre los grupos como una sola lista y ejecuta con Enter', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    expect(screen.getByRole('option', { name: /gitthul/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('option', { name: 'Checkout de main' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{Enter}');

    expect(onCheckout).toHaveBeenCalledOnce();
  });

  it('conserva la selección cuando llegan coincidencias antes de ella', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.keyboard('{ArrowDown}');
    rerender(
      <Harness
        results={[
          {
            key: 'new',
            label: 'Nuevas',
            items: [{ key: 'exact', label: 'Coincidencia exacta', onSelect: vi.fn() }],
          },
          ...groups,
        ]}
      />,
    );
    expect(screen.getByRole('option', { name: 'Checkout de main' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Checkout de dev' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('da la vuelta al final de la lista', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.keyboard('{ArrowUp}');

    expect(screen.getByRole('option', { name: 'Checkout de dev' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('explica el vacío cuando no hay resultados', () => {
    render(<Harness results={[]} />);

    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
