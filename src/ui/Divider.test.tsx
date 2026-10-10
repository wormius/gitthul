import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Divider } from './Divider';

describe('Divider', () => {
  it('expone su orientación', () => {
    render(<Divider orientation="vertical" />);

    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('el hover no desplaza la caja', () => {
    render(<Divider />);

    expectNoHoverShift(screen.getByRole('separator'));
  });
});
