import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Kbd } from './Kbd';

describe('Kbd', () => {
  it('muestra la tecla', () => {
    render(<Kbd>Ctrl</Kbd>);

    expect(screen.getByText('Ctrl')).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Kbd>Ctrl</Kbd>);

    expectNoHoverShift(screen.getByText('Ctrl'));
  });
});
