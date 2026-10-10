import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { BottomBar } from './BottomBar';
import { Button } from './Button';
import { StatusMessage } from './StatusMessage';

describe('BottomBar', () => {
  it('reparte las tres zonas dentro de una sola barra', () => {
    render(
      <BottomBar
        label="Barra inferior"
        launchers={<Button>Repositorios</Button>}
        status={<StatusMessage message="De vuelta en Repositorios" />}
        utilities={<Button>Ayuda</Button>}
      >
        <ul aria-label="Pestañas abiertas" />
      </BottomBar>,
    );

    const bar = screen.getByRole('contentinfo', { name: 'Barra inferior' });

    expect(bar).toContainElement(screen.getByRole('button', { name: 'Repositorios' }));
    expect(bar).toContainElement(screen.getByRole('list', { name: 'Pestañas abiertas' }));
    expect(bar).toContainElement(screen.getByRole('status'));
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Ayuda' }));
  });

  // Los botones de vista no son pestañas y no deben leerse como una.
  it('separa los lanzadores de la tira con un divisor', () => {
    render(
      <BottomBar label="Barra inferior" launchers={<Button>Repositorios</Button>}>
        <ul aria-label="Pestañas abiertas" />
      </BottomBar>,
    );

    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('sin lanzadores no pinta divisor', () => {
    render(<BottomBar label="Barra inferior" />);

    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(
      <BottomBar label="Barra inferior" launchers={<Button>Repositorios</Button>}>
        <ul aria-label="Pestañas abiertas" />
      </BottomBar>,
    );

    expectNoHoverShift(screen.getByRole('contentinfo'));
  });
});
