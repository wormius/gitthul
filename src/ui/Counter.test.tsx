import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Counter } from './Counter';

describe('Counter', () => {
  it('muestra el número', () => {
    render(<Counter value={12} />);

    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('antepone el prefijo cuando se da', () => {
    render(<Counter value={3} prefix="+" />);

    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Counter value={3} prefix="+" />);

    expectNoHoverShift(screen.getByText('+3'));
  });
});
