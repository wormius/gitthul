import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { Banner } from './Banner';
import { Button } from './Button';

describe('Banner', () => {
  it('avisa y ofrece su acción', () => {
    render(
      <Banner
        variant="warning"
        title="Hay un rebase de dev sobre main a medias"
        actions={<Button>Continuar el rebase</Button>}
      >
        Quedan 2 commits por aplicar.
      </Banner>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Hay un rebase de dev sobre main a medias',
    );
    expect(screen.getByText('Quedan 2 commits por aplicar.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar el rebase' })).toBeInTheDocument();
  });

  it('lo urgente se anuncia como alerta', () => {
    render(<Banner variant="danger" title="main tiene conflictos sin resolver" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('se descarta cuando trae etiqueta de descarte', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(
      <Banner
        title="origin/main tiene 4 commits nuevos"
        onDismiss={onDismiss}
        dismissLabel="Descartar el aviso"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Descartar el aviso' }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('el hover no desplaza la caja', () => {
    render(<Banner title="origin/main tiene 4 commits nuevos" />);

    expectNoHoverShift(screen.getByRole('status'));
  });
});
