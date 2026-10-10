import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';

function path(onSelect = vi.fn()): BreadcrumbItem[] {
  return [
    { key: 'root', label: 'gitthul', onSelect },
    { key: 'src', label: 'src', onSelect },
    { key: 'ui', label: 'ui', onSelect },
    { key: 'gallery', label: 'gallery', onSelect },
    { key: 'file', label: 'TokensGallery.tsx' },
  ];
}

describe('Breadcrumb', () => {
  it('marca el último tramo como el actual', () => {
    render(<Breadcrumb label="Ruta del archivo" items={path()} />);

    expect(screen.getByRole('navigation', { name: 'Ruta del archivo' })).toBeInTheDocument();
    expect(screen.getByText('TokensGallery.tsx')).toHaveAttribute('aria-current', 'page');
  });

  it('navega al pulsar un tramo intermedio', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    render(<Breadcrumb label="Ruta del archivo" items={path(onSelect)} />);
    await user.click(screen.getByRole('button', { name: 'ui' }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('pliega el centro y deja los extremos', async () => {
    const user = userEvent.setup();

    render(
      <Breadcrumb
        label="Ruta del archivo"
        items={path()}
        maxVisible={3}
        overflowLabel="Tramos ocultos"
      />,
    );

    expect(screen.getByText('gitthul')).toBeInTheDocument();
    expect(screen.getByText('TokensGallery.tsx')).toBeInTheDocument();
    expect(screen.queryByText('src')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tramos ocultos' }));

    expect(screen.getByRole('menuitem', { name: 'src' })).toBeInTheDocument();
  });

  it('el hover no desplaza la caja', () => {
    render(<Breadcrumb label="Ruta del archivo" items={path()} />);

    expectNoHoverShift(screen.getByRole('button', { name: 'ui' }));
  });
});
