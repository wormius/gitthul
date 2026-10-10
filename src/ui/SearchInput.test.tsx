import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { SearchInput } from './SearchInput';

function ControlledSearchInput() {
  const [value, setValue] = useState('');

  return <SearchInput label="Buscar ramas" value={value} onChange={setValue} clearLabel="Vaciar" />;
}

describe('SearchInput', () => {
  it('reporta el texto escrito', async () => {
    const user = userEvent.setup();

    render(<ControlledSearchInput />);
    await user.type(screen.getByLabelText('Buscar ramas'), 'dev');

    expect(screen.getByLabelText('Buscar ramas')).toHaveValue('dev');
  });

  it('no muestra el botón de vaciar sin texto, y sí con texto', () => {
    const { rerender } = render(
      <SearchInput label="Buscar ramas" value="" onChange={vi.fn()} clearLabel="Vaciar" />,
    );

    expect(screen.queryByRole('button', { name: 'Vaciar' })).not.toBeInTheDocument();

    rerender(
      <SearchInput label="Buscar ramas" value="dev" onChange={vi.fn()} clearLabel="Vaciar" />,
    );

    expect(screen.getByRole('button', { name: 'Vaciar' })).toBeInTheDocument();
  });

  it('vacía el valor al pulsar el botón de limpiar', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <SearchInput label="Buscar ramas" value="dev" onChange={onChange} clearLabel="Vaciar" />,
    );
    await user.click(screen.getByRole('button', { name: 'Vaciar' }));

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('muestra el conteo de resultados ya formateado', () => {
    render(
      <SearchInput
        label="Buscar ramas"
        value="dev"
        onChange={vi.fn()}
        clearLabel="Vaciar"
        resultsLabel="3 resultados"
      />,
    );

    expect(screen.getByText('3 resultados')).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<SearchInput label="Buscar ramas" value="" onChange={vi.fn()} clearLabel="Vaciar" />);

    expectNoHoverShift(screen.getByLabelText('Buscar ramas'));
  });
});
