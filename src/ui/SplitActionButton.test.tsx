import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { SplitActionButton } from './SplitActionButton';

const alternatives = [
  { key: 'force', label: 'Forzar Push de main', onSelect: vi.fn() },
  { key: 'tags', label: 'Push con etiquetas', onSelect: vi.fn() },
];

describe('SplitActionButton', () => {
  it('ejecuta la acción por defecto con clic izquierdo', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();

    render(
      <SplitActionButton
        label="Push"
        onAction={onAction}
        alternatives={alternatives}
        moreLabel="Más opciones de Push"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Push' }));

    expect(onAction).toHaveBeenCalledOnce();
  });

  it('despliega las alternativas con el botón de más opciones', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();

    render(
      <SplitActionButton
        label="Push"
        onAction={onAction}
        alternatives={alternatives}
        moreLabel="Más opciones de Push"
      />,
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Más opciones de Push' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Forzar Push de main' }));

    expect(alternatives[0]?.onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('despliega las alternativas también con clic derecho', () => {
    render(
      <SplitActionButton
        label="Push"
        onAction={vi.fn()}
        alternatives={alternatives}
        moreLabel="Más opciones de Push"
      />,
    );

    const group = screen.getByRole('button', { name: 'Push' }).parentElement as HTMLElement;

    fireEvent.contextMenu(group);

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(
      <SplitActionButton
        label="Push"
        onAction={vi.fn()}
        alternatives={alternatives}
        moreLabel="Más opciones de Push"
      />,
    );

    expectNoHoverShift(screen.getByRole('button', { name: 'Push' }));
  });
});
