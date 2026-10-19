import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { selectPorts } from '@core/adapters/selectPorts';
import type { TerminalPtyPort, TerminalSessionRequest } from '@core/ports/TerminalPort';
import { ThemeProvider } from '@design/ThemeProvider';
import { I18nProvider } from '@i18n/I18nProvider';
import { ToastProvider } from '@ui/ToastProvider';

import { TerminalView } from './TerminalView';

// xterm es real; el puerto registra el ciclo de vida sin abrir procesos nativos.
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function ptyView(port: TerminalPtyPort) {
  return (
    <StrictMode>
      <PortsContext value={{ ...selectPorts(), terminal: port }}>
        <ThemeProvider>
          <I18nProvider initialLocale="es-MX">
            <ToastProvider regionLabel="Avisos" dismissLabel="Cerrar aviso">
              <TerminalView sessionId="split-test" cwd="/repo" repoId={null} />
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </PortsContext>
    </StrictMode>
  );
}

function closedStartedSessions(
  createSession: ReturnType<typeof vi.fn<(request: TerminalSessionRequest) => Promise<void>>>,
  closeSession: ReturnType<typeof vi.fn<(sessionId: string) => Promise<void>>>,
) {
  const startedIds = new Set(createSession.mock.calls.map(([request]) => request.sessionId));
  return closeSession.mock.calls.map(([id]) => id).filter((id) => startedIds.has(id));
}

describe('Sesiones de paneles de terminal', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['Dividir a la derecha', 'Dividir hacia abajo'])(
    '%s crea solo el PTY nuevo y mantiene el transporte del original',
    async (action) => {
      const createSession = vi.fn((_request: TerminalSessionRequest) => Promise.resolve());
      const closeSession = vi.fn((_sessionId: string) => Promise.resolve());
      const write = vi.fn(() => Promise.resolve());
      const port: TerminalPtyPort = {
        kind: 'pty',
        createSession,
        closeSession,
        write,
        resize: vi.fn(() => Promise.resolve()),
      };
      const view = render(ptyView(port));
      await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
      const request = createSession.mock.calls[0]![0];
      const output = screen.getByRole('application', { name: 'Terminal: Terminal 1' });
      const before = new TextEncoder().encode('salida del shell original\r\n');
      act(() => request.onData(before));
      await waitFor(() => expect(output).toHaveTextContent('salida del shell original'));
      fireEvent.click(screen.getByRole('button', { name: action }));
      await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));

      expect(screen.getByRole('application', { name: 'Terminal: Terminal 1' })).toBe(output);
      expect(output).toHaveTextContent('salida del shell original');
      expect(closedStartedSessions(createSession, closeSession)).toEqual([]);
      const after = new TextEncoder().encode('el comando sigue ejecutándose\r\n');
      act(() => request.onData(after));
      await waitFor(() => expect(output).toHaveTextContent('el comando sigue ejecutándose'));
      const input = output.querySelector('textarea')!;
      fireEvent.keyDown(input, { key: 'l', keyCode: 76, which: 76 });
      expect(write).toHaveBeenLastCalledWith(request.sessionId, 'l');

      const added = createSession.mock.calls[1]![0];
      expect(added.sessionId).not.toBe(request.sessionId);
      fireEvent.click(
        within(screen.getByRole('region', { name: 'Terminal 2' })).getByRole('button', {
          name: 'Cerrar este panel de terminal',
        }),
      );
      expect(closedStartedSessions(createSession, closeSession)).toEqual([added.sessionId]);
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('application', { name: 'Terminal: Terminal 1' })).toBe(output);
      view.unmount();
      expect(closeSession).toHaveBeenLastCalledWith(request.sessionId);
      expect(closedStartedSessions(createSession, closeSession)).toEqual([
        added.sessionId,
        request.sessionId,
      ]);
    },
  );

  it.each([
    [1, 'Dividir a la derecha'],
    [1, 'Dividir hacia abajo'],
    [2, 'Dividir a la derecha'],
    [2, 'Dividir hacia abajo'],
  ])(
    'cerrar el panel inicial tras dividir abajo y luego el panel %s con %s conserva los supervivientes',
    async (splitPaneIndex, action) => {
      const createSession = vi.fn((_request: TerminalSessionRequest) => Promise.resolve());
      const closeSession = vi.fn((_sessionId: string) => Promise.resolve());
      const write = vi.fn(() => Promise.resolve());
      const port: TerminalPtyPort = {
        kind: 'pty',
        createSession,
        closeSession,
        write,
        resize: vi.fn(() => Promise.resolve()),
      };
      const view = render(ptyView(port));
      await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
      fireEvent.click(screen.getByRole('button', { name: 'Dividir hacia abajo' }));
      await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
      fireEvent.click(
        within(
          screen.getByRole('region', { name: `Terminal ${String(splitPaneIndex)}` }),
        ).getByRole('button', {
          name: action,
        }),
      );
      await waitFor(() => expect(createSession).toHaveBeenCalledTimes(3));
      const initial = createSession.mock.calls[0]![0];
      const survivors = createSession.mock.calls.slice(1).map(([request], index) => {
        const paneIndex = splitPaneIndex === 1 ? 3 - index : index + 2;
        const output = screen.getByRole('application', {
          name: `Terminal: Terminal ${String(paneIndex)}`,
        });
        act(() => request.onData(new TextEncoder().encode(`sesión ${request.sessionId}\r\n`)));
        return { request, output, input: output.querySelector('textarea')! };
      });
      for (const { request, output } of survivors) {
        await waitFor(() => expect(output).toHaveTextContent(`sesión ${request.sessionId}`));
      }
      const focused = survivors[1]!.input;
      act(() => focused.focus());
      expect(focused).toHaveFocus();
      fireEvent.click(
        within(screen.getByRole('region', { name: 'Terminal 1' })).getByRole('button', {
          name: 'Cerrar este panel de terminal',
        }),
      );

      expect(createSession).toHaveBeenCalledTimes(3);
      expect(closedStartedSessions(createSession, closeSession)).toEqual([initial.sessionId]);
      expect(screen.getAllByRole('application')).toHaveLength(2);
      for (const [index, { request, output, input }] of survivors.entries()) {
        const paneIndex = splitPaneIndex === 1 ? 2 - index : index + 1;
        expect(
          screen.getByRole('application', {
            name: `Terminal: Terminal ${String(paneIndex)}`,
          }),
        ).toBe(output);
        const host = output.closest('section')!.parentElement!;
        expect(host.parentElement?.childElementCount).toBe(1);
        expect(host.parentElement?.closest('section')).toBeNull();
        expect(output).toHaveTextContent(`sesión ${request.sessionId}`);
        act(() => request.onData(new TextEncoder().encode('continúa después del cierre\r\n')));
        await waitFor(() => expect(output).toHaveTextContent('continúa después del cierre'));
        fireEvent.keyDown(input, { key: 'l', keyCode: 76, which: 76 });
        expect(write).toHaveBeenLastCalledWith(request.sessionId, 'l');
      }
      expect(focused).toHaveFocus();
      view.unmount();
      expect(closedStartedSessions(createSession, closeSession)).toHaveLength(3);
      expect(closedStartedSessions(createSession, closeSession)).toEqual(
        expect.arrayContaining([
          initial.sessionId,
          ...survivors.map(({ request }) => request.sessionId),
        ]),
      );
    },
  );

  it('dividir durante la preparación mantiene pendiente el arranque original sin cancelarlo', async () => {
    let complete!: () => void;
    const starting = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const createSession = vi
      .fn((_request: TerminalSessionRequest) => Promise.resolve())
      .mockImplementationOnce(() => starting);
    const closeSession = vi.fn((_sessionId: string) => Promise.resolve());
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession,
      closeSession,
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
    };
    render(ptyView(port));
    await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    const request = createSession.mock.calls[0]![0];
    fireEvent.click(screen.getByRole('button', { name: 'Dividir a la derecha' }));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
    expect(closedStartedSessions(createSession, closeSession)).toEqual([]);
    expect(
      within(screen.getByRole('region', { name: 'Terminal 1' })).getByRole('progressbar'),
    ).toBeVisible();
    await act(async () => {
      complete();
      await starting;
    });
    const bytes = Uint8Array.from([65, 66]);
    act(() => request.onData(bytes));
    await waitFor(() =>
      expect(screen.getByRole('application', { name: 'Terminal: Terminal 1' })).toHaveTextContent(
        'AB',
      ),
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(closedStartedSessions(createSession, closeSession)).toEqual([]);
  });
});
