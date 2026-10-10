import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { ToastProvider } from './ToastProvider';
import { useToast } from './useToast';

/*
 * Con temporizadores falsos, y por eso con `fireEvent` en vez de `userEvent`:
 * este último programa sus propias esperas y coordinarlas con los relojes
 * falsos aporta ruido, no cobertura. Lo que hay que comprobar aquí es cuándo se
 * va el aviso, y eso se mide adelantando el reloj a mano.
 */

function Launcher({ onUndo }: { onUndo?: () => void }) {
  const toast = useToast();

  return (
    <Button
      onClick={() => {
        toast.show({
          message: 'Cambios llevados de main a dev',
          variant: 'success',
          ...(onUndo ? { action: { label: 'Deshacer', onAction: onUndo } } : {}),
        });
      }}
    >
      Cambiar de rama
    </Button>
  );
}

function History() {
  const toast = useToast();
  return (
    <>
      <span aria-label="No leídas">{toast.unread}</span>
      <span aria-label="Historial">{toast.history.map((entry) => entry.message).join('|')}</span>
      <Button onClick={toast.markHistoryRead}>Leer</Button>
      <Button onClick={toast.clearHistory}>Limpiar</Button>
    </>
  );
}

function renderProvider(onUndo?: () => void, position?: 'top-start' | 'bottom-end') {
  render(
    <ToastProvider
      regionLabel="Avisos"
      dismissLabel="Cerrar aviso"
      {...(position === undefined ? {} : { position })}
    >
      <Launcher onUndo={onUndo} />
      <History />
    </ToastProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Cambiar de rama' }));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lanza un aviso y lo retira solo', () => {
    renderProvider();

    expect(screen.getByRole('status')).toHaveTextContent('Cambios llevados de main a dev');

    advance(6000);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('coloca la región en la esquina elegida', () => {
    renderProvider(undefined, 'bottom-end');

    expect(screen.getByRole('region', { name: 'Avisos' })).toHaveAttribute(
      'data-position',
      'bottom-end',
    );
  });

  it('ofrece deshacer y lo ejecuta', () => {
    const onUndo = vi.fn();

    renderProvider(onUndo);

    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));

    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('detiene el temporizador mientras el puntero está encima', () => {
    renderProvider(vi.fn());

    fireEvent.mouseEnter(screen.getByRole('status'));
    advance(20000);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('se cierra a mano', () => {
    renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('apila los avisos en el orden en que llegan', () => {
    renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar de rama' }));

    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  it('conserva el historial aunque el toast expire y permite marcarlo y limpiarlo', () => {
    renderProvider();

    expect(screen.getByLabelText('No leídas')).toHaveTextContent('1');
    advance(6000);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Historial')).toHaveTextContent('Cambios llevados de main a dev');

    fireEvent.click(screen.getByRole('button', { name: 'Leer' }));
    expect(screen.getByLabelText('No leídas')).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(screen.getByLabelText('Historial')).toBeEmptyDOMElement();
  });

  it('limita a tres cards visibles y deja el resto en cola', () => {
    renderProvider();
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar de rama' }));
    }
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.getByLabelText('No leídas')).toHaveTextContent('5');

    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar aviso' })[0]!);
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });

  it('exige tener proveedor por encima', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Launcher />)).toThrow(/ToastProvider/);

    error.mockRestore();
  });
});
