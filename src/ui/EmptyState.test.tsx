import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('dice qué falta y por dónde se sale', () => {
    render(
      <EmptyState
        title="Todavía no hay repositorios"
        description="Abre uno que ya tengas o clona uno nuevo."
        actions={<Button variant="primary">Abrir repositorio</Button>}
      />,
    );

    expect(screen.getByText('Todavía no hay repositorios')).toBeInTheDocument();
    expect(screen.getByText('Abre uno que ya tengas o clona uno nuevo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir repositorio' })).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    const { container } = render(<EmptyState title="Sin stashes" />);

    expectNoHoverShift(container.firstElementChild as HTMLElement);
  });
});
