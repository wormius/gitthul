import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Select } from './Select';

const options = [
  { value: 'rebase', label: 'Rebasar' },
  { value: 'merge', label: 'Fusionar' },
];

describe('Select', () => {
  it('lista las opciones dadas', () => {
    render(<Select label="Estrategia de pull" options={options} />);

    expect(screen.getByRole('option', { name: 'Rebasar' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Fusionar' })).toBeInTheDocument();
  });

  it('cambia de valor al elegir una opción', async () => {
    const user = userEvent.setup();

    render(<Select label="Estrategia de pull" options={options} />);
    await user.selectOptions(screen.getByLabelText('Estrategia de pull'), 'merge');

    expect(screen.getByLabelText('Estrategia de pull')).toHaveValue('merge');
  });

  it('el hover no desplaza la caja', () => {
    render(<Select label="Estrategia de pull" options={options} />);

    expectNoHoverShift(screen.getByLabelText('Estrategia de pull'));
  });
});
