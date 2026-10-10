import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { IconButton } from './IconButton';
import { Tooltip } from './Tooltip';

function renderTooltip(delay?: number) {
  return render(
    <Tooltip content="Traer los cambios de origin/main" delay={delay}>
      <IconButton icon={<span />} aria-label="Fetch" />
    </Tooltip>,
  );
}

const trigger = () => screen.getByRole('button', { name: 'Fetch' });

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('espera al retardo antes de salir con el puntero', () => {
    renderTooltip(500);

    fireEvent.mouseEnter(trigger());

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByRole('tooltip')).toHaveTextContent('Traer los cambios de origin/main');
  });

  it('sale al instante con el foco, sin esperar', () => {
    renderTooltip(500);

    fireEvent.focus(trigger());

    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.blur(trigger());

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('describe el disparador mientras está abierto', () => {
    renderTooltip(0);

    fireEvent.focus(trigger());

    const tip = screen.getByRole('tooltip');

    expect(trigger()).toHaveAttribute('aria-describedby', tip.id);
  });

  it('se cierra con Escape', () => {
    renderTooltip(0);

    fireEvent.focus(trigger());
    fireEvent.keyDown(trigger(), { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('el puntero que se va antes del retardo no lo abre', () => {
    renderTooltip(500);

    fireEvent.mouseEnter(trigger());
    fireEvent.mouseLeave(trigger());

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('el hover no desplaza la caja del disparador', () => {
    renderTooltip(0);

    expectNoHoverShift(trigger());
  });
});
