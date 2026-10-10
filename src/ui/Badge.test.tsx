import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Badge } from './Badge';

describe('Badge', () => {
  it('muestra su contenido', () => {
    render(<Badge variant="danger">Push rechazado</Badge>);

    expect(screen.getByText('Push rechazado')).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Badge>Sin conflictos</Badge>);

    expectNoHoverShift(screen.getByText('Sin conflictos'));
  });
});
