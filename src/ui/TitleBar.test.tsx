import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoHoverShift } from '../test/noShift';
import { TitleBar } from './TitleBar';

const labels = {
  minimize: 'Minimizar la ventana',
  maximize: 'Maximizar la ventana',
  restore: 'Restaurar el tamaño de la ventana',
  close: 'Cerrar la ventana',
};

function setup(props: Partial<Parameters<typeof TitleBar>[0]> = {}) {
  const handlers = {
    onMinimize: vi.fn(),
    onToggleMaximize: vi.fn(),
    onClose: vi.fn(),
    onStartDrag: vi.fn(),
  };

  render(
    <TitleBar
      label="Barra de título"
      title="gitthul"
      detail="rama main"
      maximized={false}
      labels={labels}
      {...handlers}
      {...props}
    />,
  );

  return handlers;
}

describe('TitleBar', () => {
  it('pinta qué se está mirando y los tres controles de ventana', () => {
    setup();

    expect(screen.getByText('gitthul')).toBeInTheDocument();
    expect(screen.getByText('rama main')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.minimize })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.maximize })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.close })).toBeInTheDocument();
  });

  it('cada control llama a lo suyo', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: labels.minimize }));
    await user.click(screen.getByRole('button', { name: labels.maximize }));
    await user.click(screen.getByRole('button', { name: labels.close }));

    expect(handlers.onMinimize).toHaveBeenCalledOnce();
    expect(handlers.onToggleMaximize).toHaveBeenCalledOnce();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it('maximizada ofrece restaurar', () => {
    setup({ maximized: true });

    expect(screen.getByRole('button', { name: labels.restore })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: labels.maximize })).not.toBeInTheDocument();
  });

  it('la zona libre arrastra la ventana y el doble clic la maximiza', async () => {
    const user = userEvent.setup();
    const handlers = setup();
    const region = screen.getByText('gitthul').parentElement;

    if (!region) throw new Error('Falta la zona de arrastre');

    await user.pointer({ keys: '[MouseLeft>]', target: region });
    expect(handlers.onStartDrag).toHaveBeenCalledOnce();

    await user.dblClick(region);
    expect(handlers.onToggleMaximize).toHaveBeenCalled();
  });

  /*
   * Arrastrar entrega el puntero al gestor de ventanas. Si la segunda pulsación
   * del doble clic lo hiciera, el `dblclick` no volvería a la página y maximizar
   * con doble clic dejaría de funcionar dentro de la ventana nativa — donde,
   * además, ninguna prueba de jsdom lo vería.
   */
  it('la segunda pulsación del doble clic no arrastra', async () => {
    const user = userEvent.setup();
    const handlers = setup();
    const region = screen.getByText('gitthul').parentElement;

    if (!region) throw new Error('Falta la zona de arrastre');

    await user.dblClick(region);

    expect(handlers.onToggleMaximize).toHaveBeenCalledOnce();
    expect(handlers.onStartDrag).toHaveBeenCalledOnce();
  });

  it('pulsar un control no arrastra la ventana', async () => {
    const user = userEvent.setup();
    const handlers = setup();

    await user.click(screen.getByRole('button', { name: labels.close }));

    expect(handlers.onStartDrag).not.toHaveBeenCalled();
  });

  it('el orden y el lado de los controles son de la plataforma', () => {
    setup({ controlsSide: 'start', controlsOrder: ['close', 'minimize', 'maximize'] });

    const buttons = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));

    expect(buttons).toEqual([labels.close, labels.minimize, labels.maximize]);
  });

  it('el hover no desplaza la caja', () => {
    setup();

    expectNoHoverShift(screen.getByRole('button', { name: labels.close }));
  });
});
