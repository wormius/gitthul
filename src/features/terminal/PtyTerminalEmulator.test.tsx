import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TerminalPtyPort, TerminalSessionRequest } from '@core/ports/TerminalPort';
import { ThemeProvider } from '@design/ThemeProvider';
import { useTheme } from '@design/useTheme';
import { GestureContext } from '@app/GestureContext';
import { createGestureRegistry } from '@app/gestures';
import { createMockSystemPort } from '@core/adapters/mock/mockSystemPort';
import type { TerminalClipboardProps } from './useTerminalClipboard';

import { PtyTerminalEmulator } from './PtyTerminalEmulator';

const xterm = vi.hoisted(() => ({
  lines: [] as string[],
  instances: [] as Array<{
    cols: number;
    rows: number;
    receiveInput?: (data: string) => void;
    write: ReturnType<typeof vi.fn>;
    writeln: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    scrollToLine: ReturnType<typeof vi.fn>;
    getSelection: ReturnType<typeof vi.fn>;
    selectAll: ReturnType<typeof vi.fn>;
    paste: ReturnType<typeof vi.fn>;
    linkProvider?: {
      provideLinks: (
        lineNumber: number,
        callback: (links: Array<{ activate: () => void }>) => void,
      ) => void;
    };
    options: Record<string, unknown>;
  }>,
  resizeObservers: [] as ResizeObserverCallback[],
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    buffer = {
      active: {
        get length() {
          return xterm.lines.length;
        },
        getLine: (row: number) => ({
          translateToString: () => xterm.lines[row] ?? '',
        }),
      },
    };
    write = vi.fn();
    dispose = vi.fn();
    focus = vi.fn();
    select = vi.fn();
    scrollToLine = vi.fn();
    clearSelection = vi.fn();
    getSelection = vi.fn(() => '');
    selectAll = vi.fn();
    paste = vi.fn();
    linkProvider?: {
      provideLinks: (
        lineNumber: number,
        callback: (links: Array<{ activate: () => void }>) => void,
      ) => void;
    };
    constructor(options: Record<string, unknown>) {
      this.options = options;
      xterm.instances.push(this);
    }
    loadAddon() {}
    open() {}
    writeln = vi.fn();
    receiveInput?: (data: string) => void;
    onData(handler: (data: string) => void) {
      this.receiveInput = handler;
      return { dispose: vi.fn() };
    }
    registerLinkProvider(provider: typeof this.linkProvider) {
      this.linkProvider = provider;
      return { dispose: vi.fn() };
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));

class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    xterm.resizeObservers.push(callback);
  }
  observe() {}
  disconnect() {}
}

function pane(
  port: TerminalPtyPort,
  id: string,
  onCwd?: (cwd: string) => void,
  openExternal = vi.fn(() => Promise.resolve()),
  clipboardProps: Partial<TerminalClipboardProps> = {},
) {
  return (
    <PtyTerminalEmulator
      terminal={port}
      sessionId={id}
      cwd="/repo"
      outputLabel={id}
      errorMessage="error"
      searchLabel="Buscar en el historial"
      searchClearLabel="Vaciar búsqueda"
      searchPreviousLabel="Coincidencia anterior"
      searchNextLabel="Coincidencia siguiente"
      searchCloseLabel="Cerrar búsqueda"
      searchResultsLabel={(current, total) => `${String(current)} de ${String(total)}`}
      linkTitle="Abrir enlace externo"
      linkDescription={(domain) => `El navegador abrirá ${domain}.`}
      linkOpenLabel={(domain) => `Abrir ${domain}`}
      linkCancelLabel="Cancelar"
      openExternal={openExternal}
      exitMessage={(exit) => `exit:${String(exit.code)}`}
      onCwd={onCwd}
      clipboard={createMockSystemPort()}
      clipboardLabels={{
        menu: 'Acciones de terminal',
        copy: 'Copiar',
        paste: 'Pegar',
        selectAll: 'Seleccionar todo',
      }}
      onClipboardError={vi.fn()}
      {...clipboardProps}
    />
  );
}

function ThemeHarness({ port }: { port: TerminalPtyPort }) {
  const { update } = useTheme();

  return (
    <>
      <button type="button" onClick={() => update({ mode: 'light' })}>
        Claro
      </button>
      {pane(port, 'theme-pane')}
    </>
  );
}

describe('PtyTerminalEmulator', () => {
  beforeEach(() => {
    xterm.instances.length = 0;
    xterm.lines.length = 0;
    xterm.resizeObservers.length = 0;
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
  });

  it('sincroniza el tamaño cambiado durante el arranque y transporta las teclas sin eco local', async () => {
    let ready!: () => void;
    const starting = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const write = vi.fn(() => Promise.resolve());
    const resize = vi.fn(() => Promise.resolve());
    const createSession = vi.fn((_request: TerminalSessionRequest) => starting);
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession,
      write,
      resize,
      closeSession: vi.fn(() => Promise.resolve()),
    };
    render(<ThemeProvider>{pane(port, 'zsh-pane')}</ThemeProvider>);
    const host = screen.getByRole('application', { name: 'zsh-pane' });
    Object.defineProperties(host, {
      clientWidth: { value: 640 },
      clientHeight: { value: 480 },
    });
    await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    const request = createSession.mock.calls[0]?.[0];
    const instance = xterm.instances[0];
    if (!request || !instance) throw new Error('la sesión debe existir');
    expect(request).toMatchObject({ cols: 80, rows: 24 });

    instance.cols = 52;
    instance.rows = 13;
    xterm.resizeObservers[0]?.([], {} as ResizeObserver);
    expect(resize).not.toHaveBeenCalled();
    await act(async () => {
      ready();
      await starting;
    });
    expect(resize).toHaveBeenLastCalledWith(request.sessionId, 52, 13);

    const keys = ['echo g', '\u007f', '\u001b[3~', '\t', '\u001b[1;12R'];
    for (const key of keys) instance.receiveInput?.(key);
    expect(write.mock.calls).toEqual(keys.map((key) => [request.sessionId, key]));
    expect(instance.write).not.toHaveBeenCalled();
    expect(instance.writeln).not.toHaveBeenCalled();
    const redraw = Uint8Array.from([27, 91, 57, 48, 109, 103, 27, 91, 49, 68]);
    request.onData(redraw);
    expect(instance.write).toHaveBeenCalledExactlyOnceWith(redraw);
    act(() => request.onExit?.({ code: 0, signal: null, success: true }));
    instance.receiveInput?.('\u007f');
    expect(write).toHaveBeenCalledTimes(keys.length);
  });

  it('da a cada pane un id efímero, transporta bytes y cierra solo el desmontado', async () => {
    const requests: Parameters<TerminalPtyPort['createSession']>[0][] = [];
    const createSession = vi.fn((request: TerminalSessionRequest) => {
      requests.push(request);
      return Promise.resolve();
    });
    const closeSession = vi.fn((_sessionId: string) => Promise.resolve());
    const onCwd = vi.fn();
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession,
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      closeSession,
    };
    const view = render(
      <ThemeProvider>
        {pane(port, 'tab-1:pane-1', onCwd)}
        {pane(port, 'tab-1:pane-2')}
      </ThemeProvider>,
    );

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
    expect(requests[0]?.sessionId).not.toBe(requests[1]?.sessionId);
    expect(requests[0]?.sessionId).toContain('tab-1:pane-1:pty-');
    requests[0]?.onData(Uint8Array.from([65, 66]));
    requests[0]?.onCwd?.('/repo/packages/app');
    expect(xterm.instances[0]?.write).toHaveBeenCalledWith(Uint8Array.from([65, 66]));
    expect(onCwd).toHaveBeenCalledWith('/repo/packages/app');
    act(() => requests[0]?.onExit?.({ code: 7, signal: null, success: false }));
    expect(xterm.instances[0]?.writeln).toHaveBeenCalledWith('\r\nexit:7');
    expect(xterm.instances[0]?.options.disableStdin).toBe(true);

    view.rerender(<ThemeProvider>{pane(port, 'tab-1:pane-1')}</ThemeProvider>);
    await waitFor(() => {
      expect(closeSession).toHaveBeenCalledWith(requests[1]?.sessionId);
    });
    expect(closeSession).not.toHaveBeenCalledWith(requests[0]?.sessionId);
  });

  it('abre Mod+F, busca en todo el búfer y recorre coincidencias con Enter', async () => {
    xterm.lines.push('Needle x needle', 'sin resultado');
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession: vi.fn(() => Promise.resolve()),
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      closeSession: vi.fn(() => Promise.resolve()),
    };
    render(<ThemeProvider>{pane(port, 'search-pane')}</ThemeProvider>);
    await waitFor(() => expect(xterm.instances).toHaveLength(1));

    fireEvent.keyDown(screen.getByRole('application', { name: 'search-pane' }), {
      key: 'f',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('application', { name: 'search-pane' }), {
      key: 'f',
      ctrlKey: true,
    });
    const input = screen.getByRole('searchbox', { name: 'Buscar en el historial' });
    fireEvent.change(input, { target: { value: 'needle' } });
    expect(xterm.instances[0]?.select).toHaveBeenLastCalledWith(0, 0, 6);
    expect(screen.getByText('1 de 2')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(xterm.instances[0]?.select).toHaveBeenLastCalledWith(9, 0, 6);
    expect(screen.getByText('2 de 2')).toBeInTheDocument();
  });

  it('copia la selección de esta terminal desde el menú y desde el teclado sin mandar Ctrl+C al shell', async () => {
    const clipboard = {
      writeClipboardText: vi.fn(() => Promise.resolve()),
      readClipboardText: vi.fn(() => Promise.resolve('')),
    };
    const createSession = vi.fn(() => Promise.resolve());
    const write = vi.fn(() => Promise.resolve());
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession,
      write,
      resize: vi.fn(() => Promise.resolve()),
      closeSession: vi.fn(() => Promise.resolve()),
    };
    render(
      <ThemeProvider>{pane(port, 'copy-pane', undefined, undefined, { clipboard })}</ThemeProvider>,
    );
    await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    const host = screen.getByRole('application', { name: 'copy-pane' });
    const instance = xterm.instances[0];
    if (!instance) throw new Error('xterm debe existir');

    fireEvent.contextMenu(host, { clientX: 20, clientY: 40 });
    expect(screen.getByRole('menuitem', { name: /^Copiar/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seleccionar todo' }));
    expect(instance.selectAll).toHaveBeenCalledOnce();
    expect(clipboard.writeClipboardText).not.toHaveBeenCalled();

    instance.getSelection.mockReturnValue('selección\ncon acentos: canción');
    fireEvent.contextMenu(host, { clientX: 20, clientY: 40 });
    expect(screen.getByRole('menu', { name: 'Acciones de terminal' })).toBeInTheDocument();
    instance.getSelection.mockReturnValue('otra selección después de enfocar el menú');
    fireEvent.click(screen.getByRole('menuitem', { name: /^Copiar/ }));
    expect(clipboard.writeClipboardText).toHaveBeenLastCalledWith(
      'selección\ncon acentos: canción',
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(instance.focus).toHaveBeenCalled();

    instance.getSelection.mockReturnValue('selección por teclado');
    expect(fireEvent.keyDown(host, { key: 'c', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(clipboard.writeClipboardText).toHaveBeenLastCalledWith('selección por teclado');
    expect(fireEvent.keyDown(host, { key: 'c', ctrlKey: true })).toBe(false);
    instance.getSelection.mockReturnValue('');
    expect(fireEvent.keyDown(host, { key: 'c', ctrlKey: true })).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('pega una vez a través de xterm y descarta una lectura pendiente si el shell termina', async () => {
    let request: TerminalSessionRequest | undefined;
    const clipboard = {
      writeClipboardText: vi.fn(() => Promise.resolve()),
      readClipboardText: vi.fn(() => Promise.resolve('echo uno\necho canción')),
    };
    const createSession = vi.fn((received: TerminalSessionRequest) => {
      request = received;
      return Promise.resolve();
    });
    const write = vi.fn(() => Promise.resolve());
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession,
      write,
      resize: vi.fn(() => Promise.resolve()),
      closeSession: vi.fn(() => Promise.resolve()),
    };
    render(
      <ThemeProvider>
        {pane(port, 'paste-pane', undefined, undefined, { clipboard })}
      </ThemeProvider>,
    );
    await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    const host = screen.getByRole('application', { name: 'paste-pane' });
    const instance = xterm.instances[0];
    if (!instance) throw new Error('xterm debe existir');
    fireEvent.keyDown(host, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: /^Pegar/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Pegar/ }));
    await waitFor(() =>
      expect(instance.paste).toHaveBeenCalledExactlyOnceWith('echo uno\necho canción'),
    );
    expect(clipboard.readClipboardText).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();

    let resolve!: (text: string) => void;
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    clipboard.readClipboardText.mockReturnValueOnce(pending);
    expect(fireEvent.keyDown(host, { key: 'v', ctrlKey: true, shiftKey: true })).toBe(false);
    fireEvent.contextMenu(host);
    act(() => request?.onExit?.({ code: 0, signal: null, success: true }));
    expect(screen.getByRole('menuitem', { name: /^Pegar/ })).toBeDisabled();
    await act(async () => {
      resolve('texto tardío');
      await pending;
    });
    expect(instance.paste).toHaveBeenCalledOnce();
    fireEvent.contextMenu(host);
    expect(screen.getByRole('menuitem', { name: /^Pegar/ })).toBeDisabled();
    expect(fireEvent.keyDown(host, { key: 'v', ctrlKey: true })).toBe(true);
  });

  it('atiende Cmd+C/V en macOS y muestra los fallos sin escribirlos sobre el prompt', async () => {
    const clipboard = {
      writeClipboardText: vi.fn(() => Promise.reject(new Error('copy failed'))),
      readClipboardText: vi.fn(() => Promise.reject(new Error('paste failed'))),
    };
    const onClipboardError = vi.fn();
    const createSession = vi.fn(() => Promise.resolve());
    const write = vi.fn(() => Promise.resolve());
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession,
      write,
      resize: vi.fn(() => Promise.resolve()),
      closeSession: vi.fn(() => Promise.resolve()),
    };
    render(
      <GestureContext value={createGestureRegistry([], 'mac')}>
        <ThemeProvider>
          {pane(port, 'mac-pane', undefined, undefined, { clipboard, onClipboardError })}
        </ThemeProvider>
      </GestureContext>,
    );
    await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    const host = screen.getByRole('application', { name: 'mac-pane' });
    const instance = xterm.instances[0];
    instance?.getSelection.mockReturnValue('texto');
    expect(fireEvent.keyDown(host, { key: 'c', metaKey: true })).toBe(false);
    expect(fireEvent.keyDown(host, { key: 'v', metaKey: true })).toBe(false);
    await waitFor(() => expect(onClipboardError.mock.calls).toEqual([['copy'], ['paste']]));
    expect(instance?.writeln).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(host, { key: 'f', metaKey: true })).toBe(false);
    const search = screen.getByRole('searchbox');
    expect(fireEvent.keyDown(search, { key: 'c', metaKey: true })).toBe(true);
    expect(clipboard.writeClipboardText).toHaveBeenCalledOnce();
  });

  it('atiende el atajo de cerrar antes de xterm y deja Ctrl+C para el shell', async () => {
    const run = vi.fn();
    const gestures = createGestureRegistry(
      [
        {
          id: 'shell.closeTab',
          label: 'Cerrar',
          triggers: ['shortcut'],
          shortcut: 'Mod+W',
          allowWhileTyping: true,
          run,
        },
      ],
      'linux',
    );
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession: vi.fn(() => Promise.resolve()),
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      closeSession: vi.fn(() => Promise.resolve()),
    };
    render(
      <GestureContext value={gestures}>
        <ThemeProvider>{pane(port, 'shortcuts-pane')}</ThemeProvider>
      </GestureContext>,
    );
    await waitFor(() => expect(xterm.instances).toHaveLength(1));
    const output = screen.getByRole('application', { name: 'shortcuts-pane' });
    expect(fireEvent.keyDown(output, { key: 'c', ctrlKey: true })).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(output, { key: 'w', ctrlKey: true })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('pide un segundo gesto con el dominio visible antes de abrir un enlace HTTP(S)', async () => {
    xterm.lines.push('Visita https://docs.example.test/path).');
    const openExternal = vi.fn(() => Promise.resolve());
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession: vi.fn(() => Promise.resolve()),
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      closeSession: vi.fn(() => Promise.resolve()),
    };
    render(<ThemeProvider>{pane(port, 'link-pane', undefined, openExternal)}</ThemeProvider>);
    await waitFor(() => expect(xterm.instances[0]?.linkProvider).toBeDefined());

    let links: Array<{ activate: () => void }> = [];
    xterm.instances[0]?.linkProvider?.provideLinks(1, (provided) => {
      links = provided;
    });
    act(() => links[0]?.activate());

    expect(await screen.findByText('El navegador abrirá docs.example.test.')).toBeInTheDocument();
    expect(openExternal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir docs.example.test' }));
    expect(openExternal).toHaveBeenCalledWith('https://docs.example.test/path');
  });

  it('cambia la paleta completa de xterm a claro sin reiniciar la sesión', async () => {
    const createSession = vi.fn(() => Promise.resolve());
    const closeSession = vi.fn(() => Promise.resolve());
    const port: TerminalPtyPort = {
      kind: 'pty',
      createSession,
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      closeSession,
    };
    const darkPalette: Record<string, string> = {
      '--terminal-bg': '#111111',
      '--terminal-foreground': '#e2eee9',
      '--terminal-prompt': '#83ecad',
      '--terminal-selection': '#303030',
      '--terminal-blue': '#9ec7ff',
    };
    const lightPalette: Record<string, string> = {
      '--terminal-bg': '#fafafa',
      '--terminal-foreground': '#25352e',
      '--terminal-prompt': '#185e3c',
      '--terminal-selection': '#e4e4e4',
      '--terminal-blue': '#245a91',
    };
    const computedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          getPropertyValue: (name: string) =>
            (document.documentElement.dataset.mode === 'light' ? lightPalette : darkPalette)[
              name
            ] ?? '',
          backgroundColor: '',
          color: '',
          fontFamily: 'monospace',
          fontSize: '13px',
        }) as unknown as CSSStyleDeclaration,
    );

    render(
      <ThemeProvider initialSettings={{ mode: 'dark' }}>
        <ThemeHarness port={port} />
      </ThemeProvider>,
    );
    await waitFor(() => expect(createSession).toHaveBeenCalledOnce());
    expect(xterm.instances[0]?.options.theme).toMatchObject({ background: '#111111' });

    fireEvent.click(screen.getByRole('button', { name: 'Claro' }));

    await waitFor(() =>
      expect(xterm.instances[0]?.options.theme).toMatchObject({
        background: '#fafafa',
        foreground: lightPalette['--terminal-foreground'],
        cursor: lightPalette['--terminal-prompt'],
        cursorAccent: '#fafafa',
        selectionBackground: '#e4e4e4',
        selectionForeground: lightPalette['--terminal-foreground'],
        blue: lightPalette['--terminal-blue'],
      }),
    );
    expect(xterm.instances).toHaveLength(1);
    expect(createSession).toHaveBeenCalledOnce();
    expect(closeSession).not.toHaveBeenCalled();
    computedStyle.mockRestore();
  });
});
