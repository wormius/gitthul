import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('reporta el valor cuando es determinada', () => {
    render(<ProgressBar label="Clonando repositorio" value={42} />);

    expect(screen.getByRole('progressbar', { name: 'Clonando repositorio' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
  });

  it('no reporta un valor cuando es indeterminada', () => {
    render(<ProgressBar label="Preparando" />);

    expect(screen.getByRole('progressbar', { name: 'Preparando' })).not.toHaveAttribute(
      'aria-valuenow',
    );
  });

  it('recorta el valor al rango 0–100', () => {
    render(<ProgressBar label="Clonando repositorio" value={140} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('el hover no desplaza la caja', () => {
    render(<ProgressBar label="Clonando repositorio" value={42} />);

    expectNoHoverShift(screen.getByRole('progressbar'));
  });
});
