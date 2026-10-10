import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { useVirtualViewport } from '../test/virtualViewport';
import { VirtualList } from './VirtualList';

interface Commit {
  sha: string;
  subject: string;
}

function commits(count: number): Commit[] {
  return Array.from({ length: count }, (_, index) => ({
    sha: `sha-${String(index)}`,
    subject: `Commit número ${String(index)}`,
  }));
}

function Harness({
  count = 20,
  onSelectionChange,
  initialSelected = [],
  ...rest
}: {
  count?: number;
  onSelectionChange?: (next: ReadonlySet<string>) => void;
  initialSelected?: readonly string[];
} & Partial<Parameters<typeof VirtualList<Commit>>[0]>) {
  const [items] = useState(() => commits(count));
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initialSelected));

  return (
    <VirtualList<Commit>
      items={items}
      getKey={(commit) => commit.sha}
      label="Commits de gitthul"
      selectionMode="multiple"
      selected={selected}
      onSelectedChange={(next) => {
        setSelected(next);
        onSelectionChange?.(next);
      }}
      renderRow={(commit) => <span>{commit.subject}</span>}
      {...rest}
    />
  );
}

const list = () => screen.getByRole('listbox', { name: 'Commits de gitthul' });

describe('VirtualList', () => {
  useVirtualViewport();

  it('se anuncia como lista de selección múltiple', () => {
    render(<Harness />);

    expect(list()).toHaveAttribute('aria-multiselectable', 'true');
  });

  it('monta solo un puñado de filas aunque haya cien mil', () => {
    const started = performance.now();

    render(<Harness count={100_000} />);

    const elapsed = performance.now() - started;

    // El coste no puede depender del número de commits: lo que se monta es la
    // ventana visible más el margen, no la lista.
    expect(screen.getAllByRole('option').length).toBeLessThan(50);
    expect(elapsed).toBeLessThan(2000);
  });

  it('cambiar de fila no monta más DOM del que ya había', () => {
    render(<Harness count={100_000} />);

    const before = screen.getAllByRole('option').length;

    for (let step = 0; step < 30; step += 1) fireEvent.keyDown(list(), { key: 'ArrowDown' });

    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(before);
  });

  it('el clic selecciona una sola fila', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByText('Commit número 2'));

    const options = screen.getAllByRole('option');

    expect(
      options.filter((option) => option.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
  });

  it('Ctrl acumula y Mayús toma el rango', () => {
    const onSelectionChange = vi.fn<(next: ReadonlySet<string>) => void>();

    render(<Harness onSelectionChange={onSelectionChange} />);

    fireEvent.mouseDown(screen.getByText('Commit número 1'));
    fireEvent.mouseDown(screen.getByText('Commit número 3'), { ctrlKey: true });

    expect([...(onSelectionChange.mock.lastCall?.[0] ?? [])].sort()).toEqual(['sha-1', 'sha-3']);

    fireEvent.mouseDown(screen.getByText('Commit número 5'), { shiftKey: true });

    // El ancla sigue en la fila 3: Ctrl la movió, Mayús no.
    expect([...(onSelectionChange.mock.lastCall?.[0] ?? [])]).toEqual(['sha-3', 'sha-4', 'sha-5']);
  });

  it('las flechas mueven la fila activa y la anuncian sin sacar el foco de la lista', () => {
    render(<Harness />);

    fireEvent.keyDown(list(), { key: 'ArrowDown' });

    const active = list().getAttribute('aria-activedescendant');

    expect(active).toBeTruthy();
    expect(document.getElementById(active ?? '')).toHaveTextContent('Commit número 1');
  });

  it('no pierde pasos cuando llegan varias flechas antes de repintar', () => {
    render(<Harness />);

    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'ArrowDown' });
    fireEvent.keyDown(list(), { key: 'ArrowDown' });

    const active = list().getAttribute('aria-activedescendant');

    expect(document.getElementById(active ?? '')).toHaveTextContent('Commit número 3');
  });

  it('empieza a navegar desde la selección recibida', () => {
    render(<Harness initialSelected={['sha-5']} />);

    fireEvent.keyDown(list(), { key: 'ArrowUp' });

    const active = list().getAttribute('aria-activedescendant');

    expect(document.getElementById(active ?? '')).toHaveTextContent('Commit número 4');
  });

  it('Ctrl+A selecciona todo, también lo que no está montado', () => {
    const onSelectionChange = vi.fn<(next: ReadonlySet<string>) => void>();

    render(<Harness count={5000} onSelectionChange={onSelectionChange} />);

    fireEvent.keyDown(list(), { key: 'a', ctrlKey: true });

    expect(onSelectionChange.mock.lastCall?.[0].size).toBe(5000);
  });

  it('Enter y el doble clic abren la fila', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();

    render(<Harness onActivate={onActivate} />);

    await user.dblClick(screen.getByText('Commit número 0'));

    expect(onActivate).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(list(), { key: 'Enter' });

    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('sin nada que enseñar pinta el estado vacío', () => {
    render(<Harness count={0} empty={<p>No hay commits que coincidan con el filtro</p>} />);

    expect(screen.getByText('No hay commits que coincidan con el filtro')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('sin selección se comporta como una lista, no como un listbox', () => {
    render(<Harness selectionMode="none" />);

    expect(screen.getByRole('list', { name: 'Commits de gitthul' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('una lista activable sin selección también se recorre con las flechas', () => {
    const onActivate = vi.fn();

    render(<Harness selectionMode="none" onActivate={onActivate} />);

    const plainList = screen.getByRole('list', { name: 'Commits de gitthul' });

    fireEvent.keyDown(plainList, { key: 'ArrowDown' });
    fireEvent.keyDown(plainList, { key: 'Enter' });

    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ sha: 'sha-1' }), 1);
  });

  it('dentro de una tabla cede la semántica y se vuelve grupo de filas', () => {
    render(<Harness semantics="rowgroup" />);

    expect(screen.getByRole('rowgroup')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Harness />);

    expectNoHoverShift(list());
  });
});
