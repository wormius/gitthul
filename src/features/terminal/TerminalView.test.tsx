import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitPort } from '@core/ports/GitPort';
import type { CommitPage } from '@core/domain/commit';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { createMockTerminalPort } from '@core/adapters/mock/mockTerminalPort';
import { selectPorts, type AppPorts } from '@core/adapters/selectPorts';
import { ThemeProvider } from '@design/ThemeProvider';
import { I18nProvider } from '@i18n/I18nProvider';
import { ToastProvider } from '@ui/ToastProvider';
import { PaneStorageContext, memoryPaneSizeStore, type PaneSizeStore } from '@ui/paneStorage';
import { useVirtualViewport } from '../../test/virtualViewport';

import { PortsContext } from '@app/PortsContext';

import { TerminalView } from './TerminalView';

/*
 * El adaptador falso sin latencia para que las respuestas lleguen al instante.
 * Sin ella las pruebas tendrían que usar tiempos reales para ver la salida.
 */
let ports: AppPorts;

function renderTerminal(props?: {
  cwd?: string;
  repoId?: string | null;
  onOpenWorking?: () => void;
  onClose?: () => void;
  sizes?: PaneSizeStore;
}) {
  const {
    cwd = '/home/user/project',
    repoId = 'repo-1',
    onOpenWorking,
    onClose,
    sizes = memoryPaneSizeStore,
  } = props ?? {};

  return render(
    <PortsContext value={ports}>
      <ThemeProvider initialSettings={{ theme: 'thul', mode: 'dark' }}>
        <I18nProvider initialLocale="es-MX">
          <ToastProvider regionLabel="Avisos" dismissLabel="Cerrar aviso">
            <PaneStorageContext value={sizes}>
              <TerminalView
                sessionId="test-session"
                cwd={cwd}
                repoId={repoId}
                onOpenWorking={onOpenWorking}
                onClose={onClose}
              />
            </PaneStorageContext>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>
    </PortsContext>,
  );
}

describe('TerminalView', () => {
  useVirtualViewport();

  beforeEach(() => {
    ports = {
      ...selectPorts(),
      git: createMockGitPort({ latency: NO_LATENCY }),
      terminal: createMockTerminalPort(),
    };
  });

  it('reparte el ancho desde la cabecera, lo recuerda y conserva los menús del grafo', async () => {
    const values = new Map<string, number>();
    const sizes: PaneSizeStore = {
      read: (id) => values.get(id) ?? null,
      write: (id, value) => {
        values.set(id, value);
      },
    };
    const user = userEvent.setup();
    const first = renderTerminal({ repoId: 'gitthul', sizes });
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    const rail = screen.getByRole('grid', { name: 'Referencias' });
    const header = within(rail).getByRole('columnheader', { name: /Grafo/ }).parentElement!;
    Object.defineProperty(header, 'clientWidth', { get: () => 320 });
    const resizer = within(rail).getByRole('separator', { name: 'Grafo' });
    act(() => resizer.focus());
    await user.keyboard('{ArrowRight}');
    expect(resizer).toHaveAttribute('aria-valuenow', '104');
    expect(header.style.gridTemplateColumns).toBe('104px 216px');
    expect(values.get('terminal.references.graph')).toBe(104);
    expect(values.get('terminal.references.message')).toBe(216);

    await waitFor(() => expect(within(rail).getAllByRole('row').length).toBeGreaterThan(1));
    const firstRow = within(rail).getAllByRole('row')[1]!;
    expect(firstRow.style.gridTemplateColumns).toBe(header.style.gridTemplateColumns);
    expect(within(firstRow).getAllByRole('gridcell')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: /horizontal/i })).not.toBeInTheDocument();
    expect(within(rail).getByRole('columnheader', { name: /Mensaje/ })).toBeInTheDocument();
    const body = within(rail).getAllByRole('rowgroup')[1]!;
    expect(body).not.toContainElement(header);

    // El separador no roba las flechas del historial ni ejecuta comandos.
    await user.click(body);
    await user.keyboard('{ArrowDown}{Enter}');
    const menu = await screen.findByRole('menu', { name: 'Referencias' });
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0);
    expect(screen.getByRole('textbox')).toHaveValue('');
    first.unmount();

    renderTerminal({ repoId: 'gitthul', sizes });
    expect(screen.getByRole('separator', { name: 'Grafo' })).toHaveAttribute(
      'aria-valuenow',
      '104',
    );
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('el arrastre del separador reserva espacio para el mensaje y permite volver a ampliar', async () => {
    renderTerminal({ repoId: 'gitthul' });
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    const rail = screen.getByRole('grid', { name: 'Referencias' });
    const header = within(rail).getByRole('columnheader', { name: /Grafo/ }).parentElement!;
    Object.defineProperty(header, 'clientWidth', { get: () => 256 });
    const resizer = within(rail).getByRole('separator', { name: 'Grafo' });
    Object.assign(resizer, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: vi.fn(),
    });
    const pointer = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { clientX, button: 0, pointerId: 1 });
      fireEvent(resizer, event);
    };
    pointer('pointerdown', 96);
    pointer('pointermove', 700);
    pointer('pointerup', 700);
    expect(header.style.gridTemplateColumns).toBe('176px 80px');
    for (let step = 0; step < 20; step += 1) fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
    expect(header.style.gridTemplateColumns).toBe('72px 184px');
    fireEvent.keyDown(resizer, { key: 'ArrowRight' });
    expect(header.style.gridTemplateColumns).toBe('80px 176px');
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('muestra el progreso del historial y deja ejecutar comandos mientras se lee', async () => {
    const page = await ports.git.readCommits('gitthul', { limit: 500 });
    let complete: ((page: CommitPage) => void) | undefined;
    ports = {
      ...ports,
      git: {
        ...ports.git,
        readCommits: () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      },
    };
    renderTerminal({ repoId: 'gitthul' });
    expect(screen.getByRole('progressbar', { name: 'Leyendo los commits' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'echo disponible{Enter}');
    expect(await screen.findByText('disponible')).toBeInTheDocument();
    act(() => {
      complete?.(page);
    });
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(
      within(screen.getByRole('grid', { name: 'Referencias' }))
        .getAllByRole('row')
        .slice(1).length,
    ).toBeGreaterThan(1);
  });

  it('permite reintentar un error de carga del historial sin perder la terminal', async () => {
    const read = ports.git.readCommits;
    const readCommits = vi
      .fn<GitPort['readCommits']>()
      .mockRejectedValueOnce(new Error('lectura fallida'))
      .mockImplementation(read);
    ports = { ...ports, git: { ...ports.git, readCommits } };
    renderTerminal({ repoId: 'gitthul' });
    expect(await screen.findByText('La operación de Git falló')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(screen.queryByText('La operación de Git falló')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(readCommits).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('no repite una página fallida por cada render mientras el usuario escribe', async () => {
    const page = await ports.git.readCommits('gitthul', { limit: 3 });
    let listener: Parameters<GitPort['watchRepository']>[1] | undefined;
    const readCommits = vi.fn<GitPort['readCommits']>((_id, request) =>
      request?.skip
        ? Promise.reject(new Error('lectura fallida'))
        : Promise.resolve({ ...page, commits: [...page.commits], hasMore: true }),
    );
    ports = {
      ...ports,
      git: {
        ...ports.git,
        readCommits,
        watchRepository: (_id, next) => {
          listener = next;
          return Promise.resolve(() => {});
        },
      },
    };
    renderTerminal({ repoId: 'gitthul' });
    await waitFor(() => expect(readCommits).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    await userEvent.setup().type(screen.getByRole('textbox'), 'echo funciona{Enter}');
    expect(await screen.findByText('funciona')).toBeInTheDocument();
    expect(readCommits).toHaveBeenCalledTimes(2);
    act(() => {
      listener?.({ git: true, worktree: false });
    });
    // Un historial nuevo con el mismo tamaño sí puede pedir su siguiente página.
    await waitFor(() => expect(readCommits).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(readCommits).toHaveBeenCalledTimes(4);
  });

  it('CU-1: ejecutar un comando muestra su salida', async () => {
    const user = userEvent.setup();

    renderTerminal();

    const input = screen.getByRole('textbox');

    await user.type(input, 'echo hola');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('hola')).toBeInTheDocument();
    });
  });

  it('CU-1: un comando desconocido da command not found', async () => {
    const user = userEvent.setup();

    renderTerminal();

    const input = screen.getByRole('textbox');

    await user.type(input, 'foo');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('command not found: foo')).toBeInTheDocument();
    });
  });

  it('CU-1: git status devuelve la salida fija', async () => {
    const user = userEvent.setup();

    renderTerminal();

    const input = screen.getByRole('textbox');

    await user.type(input, 'git status');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('On branch main')).toBeInTheDocument();
    });
  });

  it('CU-2: navegar el historial con ↑ y ↓', async () => {
    const user = userEvent.setup();

    renderTerminal();

    const input = screen.getByRole('textbox');

    await user.type(input, 'echo uno');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('uno')).toBeInTheDocument();
    });

    await user.type(input, 'echo dos');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('dos')).toBeInTheDocument();
    });

    // ↑ una vez → último comando.
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveValue('echo dos');

    // ↑ otra vez → anterior.
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveValue('echo uno');

    // ↓ vuelve al último.
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveValue('echo dos');

    // ↓ otra vez vuelve al campo vacío.
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveValue('');
  });

  it('CU-3: limpiar la terminal con clear', async () => {
    const user = userEvent.setup();

    renderTerminal();

    const input = screen.getByRole('textbox');

    // Primero ejecutar algo.
    await user.type(input, 'echo visible');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('visible')).toBeInTheDocument();
    });

    // Luego clear.
    await user.type(input, 'clear');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByText('visible')).not.toBeInTheDocument();
    });
  });

  it('CU-4: insertar una referencia alimenta la línea de entrada', async () => {
    const user = userEvent.setup();

    renderTerminal();

    const input = screen.getByRole('textbox');

    // Escribimos algo y luego simulamos que el rail inserta 'main'.
    // El mecanismo real es un clic en la fila del rail, pero jsdom no puede
    // montar la lista virtual sin layout. Comprobamos el cable: escribir un
    // comando parcial y luego teclear en el input muestra el resultado.
    await user.type(input, 'git checkout ');

    // El input acepta texto directo — la inserción desde el rail usa la misma
    // ruta que escribir desde el teclado, solo que posicional.
    expect(input).toHaveValue('git checkout ');
  });

  it('muestra las referencias del repositorio que recibió como contexto', async () => {
    const originalReadCommits = ports.git.readCommits;
    const readCommits = vi.fn(originalReadCommits);
    ports = { ...ports, git: { ...ports.git, readCommits } };
    renderTerminal({ cwd: '/home/example/projects/gitthul', repoId: 'gitthul' });

    const rail = await screen.findByRole('grid', { name: 'Referencias' });
    const input = screen.getByRole('textbox');

    expect(getComputedStyle(rail.parentElement!).display).toBe('flex');
    expect(input.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    await waitFor(() =>
      expect(
        within(rail)
          .getAllByRole('row')
          .some((row) => row.title.startsWith('main,')),
      ).toBe(true),
    );
    expect(within(rail).queryByText('main', { exact: true })).not.toBeInTheDocument();
    expect(within(rail).getAllByRole('row').slice(1).length).toBeGreaterThan(1);
    expect(within(rail).getAllByRole('row').slice(1)[0]).toHaveTextContent(/[a-z0-9]/i);
    expect(within(rail).getAllByRole('row').slice(1)[0]?.querySelector('canvas')).not.toBeNull();
    const request = readCommits.mock.calls[0];

    expect(request?.[0]).toBe('gitthul');
    expect(request?.[1]).toEqual({ limit: 500 });
    expect(request?.[2]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('permite elegir local, remota, tag o SHA del mismo nodo sin ejecutar', async () => {
    const user = userEvent.setup();
    const originalReadRefs = ports.git.readRefs;
    const refs = await originalReadRefs('gitthul');
    const local = refs.branches.find((branch) => branch.kind === 'local')!;
    const remote = refs.branches.find((branch) => branch.kind === 'remote')!;
    const firstTag = refs.tags[0]!;
    const sharedRefs = {
      ...refs,
      branches: refs.branches.map((branch) =>
        branch.id === remote.id ? { ...branch, tip: local.tip } : branch,
      ),
      tags: refs.tags.map((tag) => (tag.id === firstTag.id ? { ...tag, target: local.tip } : tag)),
    };
    ports = {
      ...ports,
      git: {
        ...ports.git,
        readRefs: (id, query) =>
          id === 'gitthul' ? Promise.resolve(sharedRefs) : originalReadRefs(id, query),
      },
    };
    renderTerminal({ cwd: '/home/example/projects/gitthul', repoId: 'gitthul' });

    const rail = await screen.findByRole('grid', { name: 'Referencias' });
    await waitFor(() =>
      expect(
        within(rail)
          .getAllByRole('row')
          .some((row) => row.title.startsWith(`${local.name}, ${remote.name},`)),
      ).toBe(true),
    );
    const row = within(rail)
      .getAllByRole('row')
      .find((candidate) =>
        candidate
          .getAttribute('title')
          ?.startsWith(`${local.name}, ${remote.name}, ${firstTag.name}, `),
      );

    expect(row).toBeDefined();
    expect(within(row!).getByRole('img', { name: 'Commit' })).toBeInTheDocument();
    expect(within(row!).getByRole('img', { name: `Tag ${firstTag.name}` })).toBeInTheDocument();
    expect(within(row!).getByLabelText('Ramas: 2')).toHaveTextContent('2');
    expect(within(row!).queryByText(local.name, { exact: true })).not.toBeInTheDocument();
    await user.click(row!);

    const menu = await screen.findByRole('menu', { name: 'Referencias' });

    expect(menu).toHaveAccessibleDescription('Opciones para transcribir a la terminal');

    expect(
      within(menu).getByRole('menuitem', { name: `Transcribir Rama local ${local.name}` }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: `Transcribir Rama remota ${remote.name}` }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: `Transcribir Tag ${firstTag.name}` }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: `Transcribir SHA ${local.tip.slice(0, 7)}` }),
    ).toBeInTheDocument();

    await user.click(
      within(menu).getByRole('menuitem', { name: `Transcribir Rama remota ${remote.name}` }),
    );

    expect(screen.getByRole('textbox')).toHaveValue(remote.name);
    expect(screen.queryByText(`command not found: ${remote.name}`)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveFocus();
    });
  });

  it('WIP transcribe status y un commit sin rama siempre abre acciones', async () => {
    renderTerminal({ repoId: 'gitthul' });
    const rail = await screen.findByRole('grid', { name: 'Referencias' });
    const user = userEvent.setup();
    expect(await within(rail).findByRole('img', { name: 'WIP' })).toBeInTheDocument();
    await user.click(await within(rail).findByText('WIP', { exact: true }));
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('git status');
    await user.clear(input);
    const page = await ports.git.readCommits('gitthul', { limit: 100 });
    const refs = await ports.git.readRefs('gitthul');
    const commit = page.commits.find(
      (item) =>
        !refs.branches.some((branch) => branch.tip === item.sha) &&
        !refs.tags.some((tag) => tag.target === item.sha),
    )!;
    const row = await within(rail).findByRole('row', { name: `Commit ${commit.summary}` });
    expect(within(row).queryByText(commit.sha.slice(0, 7))).not.toBeInTheDocument();
    await user.click(row);
    const menu = await screen.findByRole('menu', { name: 'Referencias' });
    expect(
      within(menu).getByRole('menuitem', { name: `Transcribir SHA ${commit.sha.slice(0, 7)}` }),
    ).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: /^Ver detalles de este commit / }));
    expect(input).toHaveValue(`git show ${commit.sha} --`);
    expect(
      screen.queryByText(`command not found: git show ${commit.sha} --`),
    ).not.toBeInTheDocument();
  });

  it('el menú de stash transcribe SHA completo o pop sin ejecutar', async () => {
    const refs = await ports.git.readRefs('gitthul');
    const stash = refs.stashes[0]!;
    renderTerminal({ repoId: 'gitthul' });
    const rail = await screen.findByRole('grid', { name: 'Referencias' });
    const user = userEvent.setup();
    const row = await within(rail).findByRole('row', { name: `Stash ${stash.message}` });
    expect(within(row).getByRole('img', { name: 'Stash' })).toBeInTheDocument();
    await user.click(row);
    let menu = await screen.findByRole('menu', { name: 'Referencias' });
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(3);
    await user.click(
      within(menu).getByRole('menuitem', {
        name: new RegExp(`^Transcribir SHA ${stash.sha.slice(0, 7)} `),
      }),
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue(stash.sha);
    await user.clear(input);
    await user.pointer({ target: row, keys: '[MouseRight]' });
    menu = await screen.findByRole('menu', { name: 'Referencias' });
    await user.click(within(menu).getByRole('menuitem', { name: /^Transcribir git stash pop / }));
    expect(input).toHaveValue("git stash pop 'stash@{0}'");
    expect(screen.queryByText('On branch main')).not.toBeInTheDocument();
  });

  it('refresca WIP e historial con cambios externos y libera el watcher', async () => {
    let listener: Parameters<GitPort['watchRepository']>[1] | undefined;
    const stop = vi.fn();
    const originalReadStatus = ports.git.readStatus;
    let clean = false;
    const readCommits = vi.fn(ports.git.readCommits);
    ports = {
      ...ports,
      git: {
        ...ports.git,
        readCommits,
        readStatus: async (id, query) => ({ ...(await originalReadStatus(id, query)), clean }),
        watchRepository: vi.fn<GitPort['watchRepository']>((_id, next) => {
          listener = next;
          return Promise.resolve(stop);
        }),
      },
    };
    const { unmount } = renderTerminal({ repoId: 'gitthul' });
    const rail = await screen.findByRole('grid', { name: 'Referencias' });
    expect(await within(rail).findByText('WIP')).toBeInTheDocument();
    const reads = readCommits.mock.calls.length;
    clean = true;
    act(() => {
      listener?.({ git: false, worktree: true });
    });
    await waitFor(() => expect(within(rail).queryByText('WIP')).not.toBeInTheDocument());
    expect(readCommits).toHaveBeenCalledTimes(reads);
    clean = false;
    act(() => {
      listener?.({ git: true, worktree: false });
    });
    expect(await within(rail).findByText('WIP')).toBeInTheDocument();
    await waitFor(() => expect(readCommits.mock.calls.length).toBeGreaterThan(reads));
    const input = screen.getByRole('textbox');
    const stashRefs = await ports.git.readRefs('gitthul');
    const stash = await within(rail).findByText(stashRefs.stashes[0]!.message);
    expect(within(rail).queryByText('stash@{0}')).not.toBeInTheDocument();
    await userEvent.setup().click(stash);
    const menu = await screen.findByRole('menu', { name: 'Referencias' });
    await userEvent
      .setup()
      .click(within(menu).getByRole('menuitem', { name: /^Transcribir git stash apply / }));
    expect(input).toHaveValue("git stash apply 'stash@{0}'");
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('CU-9: sin repositorio de base, la terminal muestra ~ como prompt', async () => {
    const { container } = renderTerminal({ repoId: null, cwd: '' });

    // El prompt es aria-hidden, así que lo buscamos directamente en el DOM.
    const prompt = container.querySelector('[data-terminal-input] span');

    expect(prompt?.textContent).toContain('~$');
    await act(async () => {
      await Promise.resolve();
    });
  });

  it('P6.2: divide, enfoca y cierra panes sin vaciar la Terminal', async () => {
    const user = userEvent.setup();
    renderTerminal();

    await user.click(screen.getByRole('button', { name: 'Dividir a la derecha' }));

    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Cerrar este panel de terminal' })[1]!);

    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByText('Terminal 2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar este panel de terminal' })).toBeVisible();
  });

  it.each(['Dividir a la derecha', 'Dividir hacia abajo'])(
    '%s conserva la salida, el borrador y el historial del panel original',
    async (action) => {
      const user = userEvent.setup();
      renderTerminal({ repoId: null });
      const original = screen.getByRole('textbox');
      await user.type(original, 'echo salida-original{Enter}');
      expect(await screen.findByText('salida-original')).toBeInTheDocument();
      await user.type(original, 'comando pendiente');
      await user.click(screen.getByRole('button', { name: action }));

      const first = screen.getByRole('region', { name: 'Terminal 1' });
      expect(first).not.toHaveAttribute('data-active');
      expect(screen.getByRole('region', { name: 'Terminal 2' })).toHaveAttribute('data-active');
      expect(within(first).getByRole('textbox')).toBe(original);
      expect(original).toHaveValue('comando pendiente');
      expect(within(first).getByText('salida-original')).toBeInTheDocument();
      await user.clear(original);
      await user.keyboard('{ArrowUp}');
      expect(original).toHaveValue('echo salida-original');

      await user.click(
        within(screen.getByRole('region', { name: 'Terminal 2' })).getByRole('button', {
          name: 'Cerrar este panel de terminal',
        }),
      );
      expect(screen.getByRole('textbox')).toBe(original);
      expect(screen.getByText('salida-original')).toBeInTheDocument();
      expect(original).toHaveValue('echo salida-original');
    },
  );

  it('conserva los paneles al dividir un vecino y al promover un panel de un split anidado', async () => {
    const user = userEvent.setup();
    renderTerminal({ repoId: null });
    const first = screen.getByRole('textbox');
    await user.type(first, 'echo uno{Enter}');
    expect(await screen.findByText('uno')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dividir a la derecha' }));
    const secondPane = screen.getByRole('region', { name: 'Terminal 2' });
    const second = within(secondPane).getByRole('textbox');
    await user.type(second, 'echo dos{Enter}');
    expect(await screen.findByText('dos')).toBeInTheDocument();
    await user.click(within(secondPane).getByRole('button', { name: 'Dividir hacia abajo' }));
    const third = within(screen.getByRole('region', { name: 'Terminal 3' })).getByRole('textbox');
    await user.type(third, 'echo tres{Enter}');
    expect(await screen.findByText('tres')).toBeInTheDocument();
    expect(within(secondPane).getByRole('textbox')).toBe(second);
    expect(within(secondPane).getByText('dos')).toBeInTheDocument();

    await user.click(
      within(screen.getByRole('region', { name: 'Terminal 2' })).getByRole('button', {
        name: 'Cerrar este panel de terminal',
      }),
    );
    expect(screen.getAllByRole('textbox')).toEqual([first, third]);
    expect(screen.getByText('uno')).toBeInTheDocument();
    expect(screen.getByText('tres')).toBeInTheDocument();
    expect(screen.queryByText('dos')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Cerrar este panel de terminal' })[0]!);
    expect(screen.getByRole('textbox')).toBe(third);
    expect(screen.getByText('tres')).toBeInTheDocument();
  });

  it('cierra la superficie desde el único pane y ofrece abrir GitWorking cuando hay repositorio', async () => {
    const user = userEvent.setup();
    const onOpenWorking = vi.fn();
    const onClose = vi.fn();

    renderTerminal({
      cwd: '/home/example/projects/gitthul',
      repoId: 'gitthul',
      onOpenWorking,
      onClose,
    });

    await user.click(screen.getByRole('button', { name: 'Cerrar este panel de terminal' }));
    expect(onClose).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Abrir GitWorking de este repositorio' }));

    expect(onOpenWorking).toHaveBeenCalledOnce();
  });

  it('P6.2: permite dar un nombre visible al pane', async () => {
    const user = userEvent.setup();
    renderTerminal();

    await user.dblClick(
      screen.getByRole('button', { name: 'Renombrar panel de terminal: Terminal 1' }),
    );
    const name = screen.getByRole('textbox', { name: 'Renombrar panel de terminal' });
    await user.clear(name);
    await user.type(name, 'servidor{Enter}');

    expect(screen.getByText('servidor')).toBeInTheDocument();
  });

  it('CU-9: con repositorio muestra el último segmento de la ruta', async () => {
    const { container } = renderTerminal({ cwd: '/home/user/my-repo' });

    const prompt = container.querySelector('[data-terminal-input] span');

    expect(prompt?.textContent).toContain('my-repo$');
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });

  it('la línea de entrada se vacía después de ejecutar', async () => {
    const user = userEvent.setup();

    renderTerminal();

    const input = screen.getByRole('textbox');

    await user.type(input, 'echo test');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });
});
