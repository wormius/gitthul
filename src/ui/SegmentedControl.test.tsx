import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { SegmentedControl } from './SegmentedControl';

const options = [
  { value: 'list', label: 'Lista' },
  { value: 'tree', label: 'Árbol' },
] as const;

describe('SegmentedControl', () => {
  it('marca la opción activa', () => {
    render(
      <SegmentedControl
        label="Vista de archivos"
        value="list"
        onChange={vi.fn()}
        options={options}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Lista' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Árbol' })).toHaveAttribute('aria-checked', 'false');
  });

  it('avisa al elegir otra opción', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <SegmentedControl
        label="Vista de archivos"
        value="list"
        onChange={onChange}
        options={options}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Árbol' }));

    expect(onChange).toHaveBeenCalledWith('tree');
  });

  /*
   * Sin rótulos visibles, el nombre de cada casilla sigue siendo el mismo: es lo
   * que la deja alcanzable por lector de pantalla y lo que la nombra en la
   * ayuda emergente. Un icono sin nombre sería una casilla anónima.
   */
  it('sin rótulos, el nombre accesible es el de la opción', () => {
    render(
      <SegmentedControl
        label="Vista de archivos"
        hideLabels
        value="list"
        onChange={vi.fn()}
        options={options.map((option) => ({ ...option, icon: <svg /> }))}
      />,
    );

    const tree = screen.getByRole('radio', { name: 'Árbol' });

    expect(tree).toHaveAttribute('title', 'Árbol');
    expect(tree).not.toHaveTextContent('Árbol');
  });

  it('el hover no desplaza la caja', () => {
    render(
      <SegmentedControl
        label="Vista de archivos"
        value="list"
        onChange={vi.fn()}
        options={options}
      />,
    );

    expectNoHoverShift(screen.getByRole('radio', { name: 'Lista' }));
  });
});
