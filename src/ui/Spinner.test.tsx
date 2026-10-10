import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Spinner } from './Spinner';

describe('Spinner', () => {
  it('anuncia su estado con la etiqueta dada', () => {
    render(<Spinner label="Clonando repositorio" />);

    expect(screen.getByRole('status', { name: 'Clonando repositorio' })).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Spinner label="Cargando" />);

    expectNoHoverShift(screen.getByRole('status', { name: 'Cargando' }));
  });
});
