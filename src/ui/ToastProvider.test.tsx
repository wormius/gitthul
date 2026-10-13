import { useRef } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { ToastProvider } from './ToastProvider';
import { useToast } from './useToast';
import type { ToastOptions } from './toastContext';

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

function ChoiceLauncher({ options }: { options: ToastOptions }) {
  const toast = useToast();
  const id = useRef('');
  return (
    <>
      <Button
        onClick={() => {
          id.current = toast.show(options);
        }}
      >
        Mostrar aviso
      </Button>
      <Button onClick={() => toast.dismiss(id.current)}>Ocultar aviso</Button>
      <input aria-label="Trabajo" />
    </>
  );
}

function renderChoices(options: ToastOptions) {
  const view = render(
    <ToastProvider regionLabel="Avisos" dismissLabel="Cerrar aviso">
      <ChoiceLauncher options={options} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar aviso' }));
  return view;
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

  it('ofrece tres elecciones independientes y comunica el cierre por acción una sola vez', () => {
    const activate = vi.fn();
    const later = vi.fn();
    const never = vi.fn();
    const onDismiss = vi.fn();
    renderChoices({
      message: 'Consulta opcional',
      duration: 0,
      onDismiss,
      actions: [
        { label: 'Activar', onAction: activate },
        { label: 'En una semana', onAction: later },
        { label: 'No volver a sugerir', onAction: never },
      ],
    });
    expect(within(screen.getByRole('status')).getAllByRole('button')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'En una semana' }));
    expect(later).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
    expect(never).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('action');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar aviso' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('conserva la acción legacy cuando se proporcionan también varias elecciones', () => {
    const undo = vi.fn();
    const later = vi.fn();
    renderChoices({
      message: 'Cambios',
      duration: 0,
      action: { label: 'Deshacer', onAction: undo },
      actions: [{ label: 'Más tarde', onAction: later }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(undo).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('también espera el resultado asíncrono de la acción legacy sin cambiar su contrato', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((complete) => {
      resolve = complete;
    });
    const onDismiss = vi.fn();
    renderChoices({
      message: 'Cambios',
      duration: 0,
      onDismiss,
      action: { label: 'Deshacer', onAction: () => pending },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeDisabled();
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      resolve();
      await pending;
    });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('action');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    ['close', 'close'],
    ['timeout', 'timeout'],
    ['programmatic', 'programmatic'],
  ] as const)('distingue el cierre %s sin ejecutar una elección', (operation, reason) => {
    const choice = vi.fn();
    const onDismiss = vi.fn();
    renderChoices({
      message: 'Consulta opcional',
      duration: 100,
      onDismiss,
      actions: [{ label: 'Activar', onAction: choice }],
    });
    if (operation === 'close')
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    else if (operation === 'timeout') advance(100);
    else fireEvent.click(screen.getByRole('button', { name: 'Ocultar aviso' }));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith(reason);
    expect(choice).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('espera una acción asíncrona, protege doble clic y pausas, y sólo cierra después del éxito', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((complete) => {
      resolve = complete;
    });
    const activate = vi.fn(() => pending);
    const alternate = vi.fn();
    const onDismiss = vi.fn();
    renderChoices({
      message: 'Consulta opcional',
      duration: 100,
      onDismiss,
      actions: [
        { label: 'Activar', onAction: activate },
        { label: 'En una semana', onAction: alternate },
        { label: 'No volver', onAction: alternate },
      ],
    });
    const button = screen.getByRole('button', { name: 'Activar' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    for (const control of within(screen.getByRole('status')).getAllByRole('button'))
      expect(control).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Trabajo' })).toBeEnabled();
    advance(10000);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      resolve();
      await pending;
    });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('action');
    expect(alternate).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('un rechazo mantiene el aviso, rehabilita las acciones, conserva foco y permite reintentar', async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    const action = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const onDismiss = vi.fn();
    renderChoices({
      message: 'Consulta opcional',
      duration: 0,
      onDismiss,
      actions: [{ label: 'Activar', onAction: action }],
    });
    const button = screen.getByRole('button', { name: 'Activar' });
    act(() => button.focus());
    fireEvent.click(button);
    act(() => button.blur());
    await act(async () => {
      reject(new Error('write failed'));
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
    expect(button).toBeEnabled();
    expect(button).toHaveFocus();
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('action');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('no roba foco al mostrar el aviso ni al fallar si la persona continuó trabajando', async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => {
      reject = fail;
    });
    renderChoices({
      message: 'Consulta opcional',
      duration: 0,
      actions: [{ label: 'Activar', onAction: () => pending }],
    });
    const work = screen.getByRole('textbox', { name: 'Trabajo' });
    act(() => work.focus());
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar aviso' }));
    expect(work).toHaveFocus();
    const button = screen.getAllByRole('button', { name: 'Activar' })[0]!;
    act(() => button.focus());
    fireEvent.click(button);
    act(() => work.focus());
    await act(async () => {
      reject(new Error('write failed'));
      await Promise.resolve();
    });
    expect(work).toHaveFocus();
  });

  it('un fallo síncrono o del callback de cierre no rompe la región', () => {
    const onDismiss = vi.fn(() => {
      throw new Error('callback failed');
    });
    renderChoices({
      message: 'Consulta opcional',
      duration: 0,
      onDismiss,
      actions: [
        {
          label: 'Activar',
          onAction: () => {
            throw new Error('action failed');
          },
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activar' })).toBeEnabled();
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('close');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('retirar programáticamente una acción pendiente no informa luego otra elección', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((complete) => {
      resolve = complete;
    });
    const onDismiss = vi.fn();
    renderChoices({
      message: 'Consulta opcional',
      duration: 0,
      onDismiss,
      actions: [{ label: 'Activar', onAction: () => pending }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar aviso' }));
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('programmatic');
    await act(async () => {
      resolve();
      await pending;
    });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('desmontar con una acción pendiente no registra un cierre ni programa temporizadores nuevos', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((complete) => {
      resolve = complete;
    });
    const onDismiss = vi.fn();
    const { unmount } = renderChoices({
      message: 'Consulta opcional',
      duration: 100,
      onDismiss,
      actions: [{ label: 'Activar', onAction: () => pending }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
    unmount();
    await act(async () => {
      resolve();
      await pending;
      vi.advanceTimersByTime(10000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('salir con el puntero conserva la pausa mientras una acción aún tiene foco', () => {
    renderChoices({
      message: 'Consulta opcional',
      duration: 100,
      actions: [{ label: 'Activar', onAction: vi.fn() }],
    });
    const toast = screen.getByRole('status');
    const button = screen.getByRole('button', { name: 'Activar' });
    fireEvent.mouseEnter(toast);
    act(() => button.focus());
    fireEvent.mouseLeave(toast);
    advance(1000);
    expect(toast).toBeInTheDocument();
    act(() => button.blur());
    advance(100);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
