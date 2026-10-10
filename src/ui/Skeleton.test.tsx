import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('queda fuera del árbol de accesibilidad', () => {
    const { container } = render(<Skeleton />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    const { container } = render(<Skeleton />);
    const skeleton = container.firstElementChild as HTMLElement;

    expectNoHoverShift(skeleton);
  });
});
