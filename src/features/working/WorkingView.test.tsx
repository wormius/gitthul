import { initSettingsData } from '../settings/useSettingsData';
import { DEFAULT_SETTINGS } from '@core/domain/settings';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@app/App';
import { PortsContext } from '@app/PortsContext';
import { restoreShellSession, useShellStore } from '@app/shellStore';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { createMockSystemPort } from '@core/adapters/mock/mockSystemPort';
import { createMockLibraryPort } from '@core/adapters/mock/mockLibraryPort';
import { selectPorts, type AppPorts } from '@core/adapters/selectPorts';
import { isMerge, shortSha, type Commit, type CommitPageRequest } from '@core/domain/commit';
import { normalizeSession } from '@core/domain/session';
import { GitOperationError, OperationCancelledError } from '@core/domain/errors';
import type { WorkingStatus } from '@core/domain/status';
import { useRepositoriesStore } from '@features/repositories/repositoriesStore';
import { useResolveStore } from '@features/resolve/resolveStore';
import { useWorkingStore } from '@features/working/workingStore';
import { ThemeProvider } from '@design/ThemeProvider';
import { I18nProvider } from '@i18n/I18nProvider';

import { useVirtualViewport } from '../../test/virtualViewport';

const GITTHUL_PATH = '/home/example/projects/gitthul';
/** El repositorio del fixture que nació con una fusión a medias. */
const BITACORA_PATH = '/home/example/projects/bitacora';

function makePorts(latency = NO_LATENCY): AppPorts {
  return {
    ...selectPorts(),
    git: createMockGitPort({ latency }),
    system: createMockSystemPort(),
    library: createMockLibraryPort(),
  };
}

function renderApp(ports: AppPorts) {
  return render(
    <PortsContext value={ports}>
      <ThemeProvider initialSettings={{ theme: 'thul', mode: 'dark' }}>
        <I18nProvider initialLocale="es-MX">
          <App />
        </I18nProvider>
      </ThemeProvider>
    </PortsContext>,
  );
}

/** Doble clic real: selecciona con el primero y abre con el segundo. */
async function openRepo(user: ReturnType<typeof userEvent.setup>, path: string) {
  const rows = await screen.findAllByRole('option');
  const row = rows.find((candidate) => within(candidate).queryByText(path) !== null);

  if (!row) throw new Error(`No hay ninguna fila en la carpeta ${path}`);

  const target = within(row).getByText(path);

  await user.click(target);

  const second = { button: 0, detail: 1 };

  fireEvent.mouseDown(target, second);
  fireEvent.mouseUp(target, second);
  fireEvent.click(target, second);
}

beforeEach(() => {
  initSettingsData(DEFAULT_SETTINGS);
  useShellStore.getState().reset();
  useRepositoriesStore.getState().reset();
  useWorkingStore.getState().reset();
});

describe('WorkingView', () => {
  it('does not replay previous network requests when reopening a repository view', async () => {
    const ports = makePorts();
    const fetch = vi.spyOn(ports.git, 'fetch');
    const pull = vi.spyOn(ports.git, 'pull');
    const push = vi.spyOn(ports.git, 'push');
    const user = userEvent.setup();
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('grid', { name: 'Commits de gitthul' });
    act(() => useWorkingStore.getState().requestFetch());
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useWorkingStore.getState().networkBusy).toBe(false));
    act(() => useShellStore.getState().openSettings());
    act(() => useWorkingStore.setState({ pullRequest: 7, pushRequest: 8 }));
    fetch.mockClear();
    pull.mockClear();
    push.mockClear();
    act(() => useShellStore.setState({ settingsOpen: false }));
    await screen.findByRole('grid', { name: 'Commits de gitthul' });
    expect(fetch).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    act(() => useWorkingStore.getState().requestPull());
    await waitFor(() => expect(pull).toHaveBeenCalledTimes(1));
  });

  useVirtualViewport();

  it('el avatar pliega, abre el mismo menú en el rail y expande con clic izquierdo', async () => {
    const user = userEvent.setup();
    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);
    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    await user.click(within(panel).getByRole('img', { name: 'gitthul' }));
    const rail = await screen.findByRole('toolbar', { name: 'Referencias de gitthul' });
    fireEvent.contextMenu(within(rail).getByRole('img', { name: 'gitthul' }));
    expect(await screen.findByRole('menuitem', { name: 'Cambiar avatar' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(within(rail).getByRole('img', { name: 'gitthul' }));
    expect(await screen.findByRole('region', { name: 'Referencias de gitthul' })).toBeVisible();
  });

  it('pulsar la rama del encabezado va a su nodo sin plegar el panel', async () => {
    const user = userEvent.setup();
    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);
    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const header = within(panel).getByRole('button', { name: /Plegar.*gitthul/ });
    const before = useWorkingStore.getState().goTo;

    await user.click(within(header).getByText('main'));

    expect(screen.getByRole('region', { name: 'Referencias de gitthul' })).toBeVisible();
    expect(useWorkingStore.getState().goTo?.sha).toBeDefined();
    expect(useWorkingStore.getState().goTo?.nonce).not.toBe(before?.nonce);
  });

  it('el perfil elegido configura la identidad Git del repositorio', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const commit = vi.spyOn(ports.git, 'commit');
    initSettingsData({
      ...DEFAULT_SETTINGS,
      git: {
        ...DEFAULT_SETTINGS.git,
        profiles: [
          {
            id: 'personal',
            name: 'Personal',
            email: 'personal@example.test',
            avatarGlyph: '',
            avatarTone: 0,
          },
          {
            id: 'work',
            name: 'Work',
            email: 'work@example.test',
            avatarGlyph: '',
            avatarTone: 0,
          },
        ],
      },
    });
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const composer = within(
      await screen.findByRole('region', { name: 'Redactar el commit para main' }),
    );
    const selector = await composer.findByRole('button', { name: /Alex <alex@ejemplo.org>/ });
    await user.click(selector);
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /Work/ }));
    await user.type(
      screen.getByRole('textbox', { name: 'Resumen del commit' }),
      'Commit con perfil',
    );
    await user.click(screen.getByRole('button', { name: 'Hacer commit en main' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(await ports.git.readIdentity('gitthul')).toEqual({
      name: 'Work',
      email: 'work@example.test',
    });
    expect(commit.mock.calls[0]?.[1].author).toBeUndefined();
  });

  it('descartar todo pide confirmación y mantiene progreso hasta terminar', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    let finish!: (status: WorkingStatus) => void;
    const discard = vi.spyOn(ports.git, 'discardAll').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await user.click(await screen.findByRole('button', { name: 'Descartar todo el WIP' }));
    const dialog = await screen.findByRole('dialog', { name: 'Descartar todo el WIP' });
    expect(discard).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole('button', { name: 'Descartar todo el WIP' });
    await user.click(confirm);
    expect(discard).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole('status', { name: 'Procesando operación…' })).toBeVisible();
    expect(confirm).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(dialog).toBeVisible();
    const current = await ports.git.readStatus('gitthul');
    act(() => finish({ ...current, staged: [], unstaged: [], conflicted: [] }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('abrir una vista no repite peticiones antiguas de Deshacer/Rehacer', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const undo = vi.spyOn(ports.git, 'undo');
    const redo = vi.spyOn(ports.git, 'redo');
    useWorkingStore.setState({ undoRequest: 3, redoRequest: 2 });
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('region', { name: 'Referencias de gitthul' });
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });

  it('Ctrl+Enter envía desde el resumen y Ctrl+Z dentro del texto no deshace Git', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const commit = vi.spyOn(ports.git, 'commit');
    const undo = vi.spyOn(ports.git, 'undo');
    const redo = vi.spyOn(ports.git, 'redo');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const summary = await screen.findByRole('textbox', { name: 'Resumen del commit' });
    await user.type(summary, 'Commit con teclado');
    act(() => {
      const state = useWorkingStore.getState();
      if (state.context) state.setContext({ ...state.context, undoCount: 1, redoCount: 1 });
    });
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Rehacer' })).toBeEnabled();
    await user.keyboard('{Control>}z{/Control}{Control>}{Shift>}z{/Shift}{/Control}');
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Abrir Configuraciones' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(commit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Regresar' }));
    const reopenedSummary = await screen.findByRole('textbox', { name: 'Resumen del commit' });
    await user.clear(reopenedSummary);
    await user.type(reopenedSummary, 'Commit con teclado');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith(
        'gitthul',
        expect.objectContaining({ summary: 'Commit con teclado' }),
      ),
    );
  });

  it('un formulario modal no envía el commit de la vista que queda detrás', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const commit = vi.spyOn(ports.git, 'commit');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await user.type(
      await screen.findByRole('textbox', { name: 'Resumen del commit' }),
      'Borrador pendiente',
    );
    await act(async () => {
      useWorkingStore.getState().openDialog({
        kind: 'createBranch',
        from: { kind: 'branch', name: 'main' },
        fromLabel: 'main',
      });
      await Promise.resolve();
    });
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('textbox'));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(commit).not.toHaveBeenCalled();
    expect(useWorkingStore.getState().commitDraft.summary).toBe('Borrador pendiente');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  });

  it('POP sin guardados no queda pendiente al crear un stash', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    for (const stash of [...refs.stashes].reverse()) {
      await ports.git.dropStash('gitthul', stash.index, { expectedStash: stash.sha });
    }
    const apply = vi.spyOn(ports.git, 'applyStash');
    const create = vi.spyOn(ports.git, 'createStash');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const pop = await screen.findByRole('button', {
      name: 'Aplicar y eliminar el stash seleccionado (pop)',
    });
    expect(pop).toBeDisabled();
    // Even a request bypassing the disabled gesture must be consumed immediately.
    act(() => useWorkingStore.getState().requestPop());
    await user.click(screen.getByRole('button', { name: 'Crear stash' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear stash' })).toBeDisabled());
    expect(apply).not.toHaveBeenCalled();
  });

  it('POP exige un único stash seleccionado y aplica ese stash', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    const target = refs.stashes[1]!;
    const apply = vi.spyOn(ports.git, 'applyStash');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const pop = await screen.findByRole('button', {
      name: 'Aplicar y eliminar el stash seleccionado (pop)',
    });
    expect(pop).toBeDisabled();
    act(() => useWorkingStore.setState({ selectedCommits: new Set(['wip']) }));
    expect(pop).toBeDisabled();
    act(() =>
      useWorkingStore.setState({
        selectedCommits: new Set(['stash:0', 'stash:1']),
      }),
    );
    expect(pop).toBeDisabled();
    act(() =>
      useWorkingStore.setState({
        selectedCommits: new Set([`stash:${String(target.index)}`]),
      }),
    );
    await waitFor(() => expect(pop).toBeEnabled());
    await user.click(pop);
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith(
        'gitthul',
        target.index,
        expect.objectContaining({ expectedStash: target.sha, drop: true }),
      ),
    );
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('abrir una vista no repite una petición antigua de Stash', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const create = vi.spyOn(ports.git, 'createStash');
    useWorkingStore.setState({ stashRequest: 3 });
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('region', { name: 'Referencias de gitthul' });
    expect(create).not.toHaveBeenCalled();
  });

  it('la barra explica y recupera la preparación de archivos', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const before = await ports.git.readStatus('gitthul');
    const path = before.unstaged[0]!.path;
    await ports.git.stage('gitthul', [path]);
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const undo = await screen.findByRole('button', { name: 'Deshacer' });
    await waitFor(() => expect(undo).toBeEnabled());
    expect(undo).toHaveAttribute('title', expect.stringContaining('Agregar cambios al staging'));
    await user.click(undo);
    await waitFor(async () => expect(await ports.git.readStatus('gitthul')).toEqual(before));
    const redo = screen.getByRole('button', { name: 'Rehacer' });
    await waitFor(() => expect(redo).toBeEnabled());
    await user.click(redo);
    await waitFor(async () =>
      expect(
        (await ports.git.readStatus('gitthul')).staged.some((file) => file.path === path),
      ).toBe(true),
    );
  });

  it.each([false, true])(
    'abre la vista y no trata un upstream ausente como publicado (ausente: %s)',
    async (missing) => {
      const user = userEvent.setup();
      const ports = makePorts();
      const readRefs = ports.git.readRefs.bind(ports.git);
      vi.spyOn(ports.git, 'readRefs').mockImplementation(async (...args) => {
        const refs = await readRefs(...args);
        return {
          ...refs,
          branches: refs.branches.map((branch) => {
            if (branch.kind !== 'local') return branch;
            if (branch.isHead)
              return {
                ...branch,
                upstream: missing ? 'origin/removed' : branch.upstream,
                upstreamMissing: missing,
                ahead: 0,
                behind: 0,
              };
            return missing && branch.name === 'dev'
              ? {
                  ...branch,
                  upstream: 'origin/missing-dev',
                  upstreamMissing: true,
                  ahead: 9,
                  behind: 3,
                }
              : branch;
          }),
        };
      });
      const checkout = vi.spyOn(ports.git, 'checkout');

      renderApp(ports);
      await openRepo(user, GITTHUL_PATH);
      const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
      const panel = screen.getByRole('region', { name: 'Referencias de gitthul' });
      const locals = within(panel).getByRole('group', { name: 'Ramas locales' });
      if (missing) {
        expect(
          within(locals).getByTitle('El upstream origin/removed ya no existe.'),
        ).toBeInTheDocument();
        expect(
          within(locals).queryByLabelText('9 commits por delante y 3 por detrás del upstream'),
        ).not.toBeInTheDocument();
        expect(
          within(grid).getByTitle('Rama activa main. El upstream origin/removed ya no existe.'),
        ).toBeInTheDocument();
        expect(useWorkingStore.getState().context?.headUpstream).toBeNull();
      }

      await user.click(
        screen.getByRole('checkbox', { name: 'Modificar el último commit (amend)' }),
      );
      await waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Resumen del commit' })).toBeEnabled(),
      );
      const published = screen.queryByText(/main ya está publicada en/);
      if (missing) expect(published).not.toBeInTheDocument();
      else expect(published).toBeInTheDocument();

      if (missing) {
        await user.dblClick(within(grid).getByTitle('Rama remota main'));
        const dialog = await screen.findByRole('dialog', {
          name: 'main y la remota tienen puntas distintas',
        });
        expect(
          within(dialog).getByText(
            /El upstream origin\/removed de main ya no existe y no hay conteos disponibles/,
          ),
        ).toBeInTheDocument();
        expect(within(dialog).queryByText(/0 commits/)).not.toBeInTheDocument();
        expect(checkout).not.toHaveBeenCalled();
        await user.click(within(dialog).getByRole('button', { name: 'No hacer nada' }));
      }
    },
  );

  it('pinta las cinco secciones con datos reales del repositorio', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });

    // Locales: cuatro ramas, y `main` —la activa— con su seguimiento ↑7.
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });

    expect(
      within(panel).getByRole('button', { name: 'Plegar Ramas locales' }).textContent,
    ).toContain('4');
    expect(within(locals).getByText('main')).toBeInTheDocument();
    expect(
      within(locals).getByLabelText('7 commits por delante y 0 por detrás del upstream'),
    ).toBeInTheDocument();

    // Remotas: árbol por remoto, con `origin` como raíz y sus ramas dentro.
    const tree = within(panel).getByRole('tree', { name: 'Ramas remotas' });

    expect(within(tree).getByText('origin')).toBeInTheDocument();
    expect(within(tree).getByText('main')).toBeInTheDocument();

    // Tags, Guardados y Worktrees: sus contadores, sin entrar en el detalle.
    expect(within(panel).getByRole('button', { name: 'Plegar Tags' }).textContent).toContain('3');
    expect(within(panel).getByRole('button', { name: 'Plegar Stashes' }).textContent).toContain(
      '2',
    );
    expect(within(panel).getByRole('button', { name: 'Plegar Worktrees' }).textContent).toContain(
      '2',
    );

    // GitActionBar: Undo/Redo/Stash/Pop están habilitados desde F2.8;
    // Fetch/Pull/Push siguen deshabilitados hasta F2.9.
    const bar = screen.getByRole('toolbar', { name: 'Barra de acciones de GitWorking' });

    expect(within(bar).getByRole('button', { name: 'Deshacer' })).toBeDisabled();
    expect(
      within(bar).getByRole('button', {
        name: 'Abrir otra pestaña de terminal desde la pestaña activa',
      }),
    ).toBeEnabled();

    // CommitTable: cabecera de las seis columnas, el nodo WIP arriba con su
    // conteo de archivos —dos preparados y cuatro sin preparar, sin rutas
    // compartidas— y filas de commit reales debajo.
    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });

    expect(within(grid).getByRole('columnheader', { name: /Rama\/Tag/ })).toBeInTheDocument();
    expect(within(grid).getByRole('columnheader', { name: /Grafo/ })).toBeInTheDocument();
    expect(within(grid).getByText('WIP')).toBeInTheDocument();
    expect(within(grid).getByText('6')).toBeInTheDocument();
    expect(within(grid).getAllByRole('row').length).toBeGreaterThan(1);

    // La columna Grafo trae su propio scroll horizontal — F2.3—, que es lo que
    // la deja crecer con las calles sin comerse la columna del mensaje.
    expect(
      screen.getByRole('region', { name: 'Desplazamiento horizontal del grafo' }),
    ).toBeInTheDocument();

    // El panel derecho enseña Cambios y Stage con StagingPanel — F2.5.
    expect(screen.getByRole('region', { name: 'Cambios' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Staging' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Todos los archivos' })).not.toBeInTheDocument();
    // `FileList` separa la carpeta del nombre en dos `span`, así que el texto
    // completo de la ruta no vive en un solo nodo — se busca por el nombre.
    expect(screen.getByText('inventario.md')).toBeInTheDocument();
  }, 10_000);

  it('la cabecera del repositorio ofrece sus operaciones contextuales', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    fireEvent.contextMenu(within(panel).getByRole('img', { name: 'gitthul' }));

    expect(
      await screen.findByRole('menuitem', { name: 'Copiar el nombre del repositorio' }),
    ).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Copiar la ruta del repositorio' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Cambiar avatar' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Cerrar GitWorking' })).toBeVisible();

    await user.click(screen.getByRole('menuitem', { name: 'Cambiar avatar' }));
    expect(await screen.findByRole('dialog', { name: 'Avatar de gitthul' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
  }, 10_000);

  it('integra la espera en el centro sin texto visible y mantiene bloqueadas las escrituras', async () => {
    const user = userEvent.setup();
    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);
    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const refs = screen.getByRole('region', { name: 'Referencias de gitthul' });
    const composer = await screen.findByRole('textbox', { name: 'Resumen del commit' });
    const divider = screen.getByRole('separator', {
      name: 'Ancho del panel de detalles',
    });
    const centerPane = divider.previousElementSibling as HTMLElement;
    const detailsPane = divider.nextElementSibling as HTMLElement;

    act(() => useWorkingStore.setState({ detailsCollapsed: true, pendingWrites: 1 }));

    const progress = within(centerPane).getByRole('progressbar', {
      name: 'Procesando operación…',
    });
    expect(progress).toBeVisible();
    expect(progress.closest('[inert]')).toBeNull();
    expect(detailsPane).toHaveAttribute('inert');
    expect(screen.queryByText('Procesando operación…')).not.toBeInTheDocument();
    expect(grid.closest('[inert]')).not.toBeNull();
    expect(refs.closest('[inert]')).not.toBeNull();
    expect(composer.closest('[inert]')).not.toBeNull();

    act(() => useWorkingStore.setState({ pendingWrites: 0 }));

    expect(progress.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(detailsPane).toHaveAttribute('inert');
    expect(useWorkingStore.getState().detailsCollapsed).toBe(true);
    expect(grid.closest('[inert]')).toBeNull();
    expect(refs.closest('[inert]')).toBeNull();
  });

  it('muestra el progreso de fetch en el centro y lo cancela por la acción tipada', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const fetch = vi.fn(
      (
        _id: Parameters<AppPorts['git']['fetch']>[0],
        _remote: Parameters<AppPorts['git']['fetch']>[1],
        options: Parameters<AppPorts['git']['fetch']>[2],
        query: Parameters<AppPorts['git']['fetch']>[3],
      ) =>
        new Promise<never>((_resolve, reject) => {
          options?.onProgress?.({ phase: 'receiving', received: 4, total: 10 });
          query?.signal?.addEventListener(
            'abort',
            () => {
              reject(new OperationCancelledError());
            },
            { once: true },
          );
        }),
    );
    renderApp({ ...ports, git: { ...ports.git, fetch } });
    await openRepo(user, GITTHUL_PATH);
    act(() => useWorkingStore.setState({ detailsCollapsed: true }));

    await user.click(await screen.findByRole('button', { name: 'Hacer fetch' }));
    const divider = screen.getByRole('separator', {
      name: 'Ancho del panel de detalles',
    });
    const centerPane = divider.previousElementSibling as HTMLElement;
    const detailsPane = divider.nextElementSibling as HTMLElement;
    expect(
      await within(centerPane).findByRole('progressbar', { name: 'Recibiendo los objetos' }),
    ).toHaveAttribute('aria-valuenow', '40');
    expect(screen.queryByText('Recibiendo los objetos')).not.toBeInTheDocument();
    expect(detailsPane).toHaveAttribute('inert');
    const fetchCall = fetch.mock.calls[0];
    expect(fetchCall?.slice(0, 2)).toEqual(['gitthul', null]);
    expect(typeof fetchCall?.[2]?.onProgress).toBe('function');
    expect(fetchCall?.[3]?.signal).toBeInstanceOf(AbortSignal);

    const cancel = screen.getByRole('button', { name: 'Cancelar la transferencia' });
    expect(cancel.closest('[inert]')).toBeNull();
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    const fetchButton = screen.getByRole('button', { name: 'Hacer fetch' });
    expect(fetchButton).toBeEnabled();
    expect(fetchButton).toHaveFocus();
    expect(detailsPane).toHaveAttribute('inert');
  }, 10_000);

  it('pull comparte progreso y cancelación y devuelve el foco a su propio botón', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const pull = vi.fn(
      (
        _id: Parameters<AppPorts['git']['pull']>[0],
        options: Parameters<AppPorts['git']['pull']>[1],
        query: Parameters<AppPorts['git']['pull']>[2],
      ) =>
        new Promise<never>((_resolve, reject) => {
          options?.onProgress?.({ phase: 'receiving', received: 3, total: 5 });
          query?.signal?.addEventListener(
            'abort',
            () => {
              reject(new OperationCancelledError());
            },
            { once: true },
          );
        }),
    );
    renderApp({ ...ports, git: { ...ports.git, pull } });
    await openRepo(user, GITTHUL_PATH);

    const pullButton = await screen.findByRole('button', { name: 'Hacer pull' });
    await user.click(pullButton);
    const centerPane = screen.getByRole('separator', {
      name: 'Ancho del panel de detalles',
    }).previousElementSibling as HTMLElement;
    expect(
      await within(centerPane).findByRole('progressbar', { name: 'Recibiendo los objetos' }),
    ).toHaveAttribute('aria-valuenow', '60');
    expect(screen.queryByText('Recibiendo los objetos')).not.toBeInTheDocument();
    const pullCall = pull.mock.calls[0];
    expect(pullCall?.[0]).toBe('gitthul');
    expect(pullCall?.[1]?.strategy).toBe('auto');
    expect(typeof pullCall?.[1]?.onProgress).toBe('function');
    expect(pullCall?.[2]?.signal).toBeInstanceOf(AbortSignal);

    const cancel = screen.getByRole('button', { name: 'Cancelar la transferencia' });
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(pullButton).toBeEnabled();
    expect(pullButton).toHaveFocus();
  });

  it('push comparte progreso y cancelación y devuelve el foco a su propio botón', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const push = vi.fn(
      (
        _id: Parameters<AppPorts['git']['push']>[0],
        _branch: Parameters<AppPorts['git']['push']>[1],
        options: Parameters<AppPorts['git']['push']>[2],
        query: Parameters<AppPorts['git']['push']>[3],
      ) =>
        new Promise<never>((_resolve, reject) => {
          options?.onProgress?.({ phase: 'compressing', received: 2, total: 5 });
          query?.signal?.addEventListener(
            'abort',
            () => {
              reject(new OperationCancelledError());
            },
            { once: true },
          );
        }),
    );
    renderApp({ ...ports, git: { ...ports.git, push } });
    await openRepo(user, GITTHUL_PATH);

    const pushButton = await screen.findByRole('button', { name: 'Hacer push' });
    await user.click(pushButton);
    const centerPane = screen.getByRole('separator', {
      name: 'Ancho del panel de detalles',
    }).previousElementSibling as HTMLElement;
    expect(
      await within(centerPane).findByRole('progressbar', { name: 'Comprimiendo los objetos' }),
    ).toHaveAttribute('aria-valuenow', '40');
    expect(screen.queryByText('Comprimiendo los objetos')).not.toBeInTheDocument();
    expect(push.mock.calls[0]?.slice(0, 2)).toEqual(['gitthul', 'main']);
    expect(typeof push.mock.calls[0]?.[2]?.onProgress).toBe('function');
    expect(push.mock.calls[0]?.[3]?.signal).toBeInstanceOf(AbortSignal);

    const cancel = screen.getByRole('button', { name: 'Cancelar la transferencia' });
    expect(cancel).toHaveFocus();
    await user.click(cancel);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(pushButton).toBeEnabled();
    expect(pushButton).toHaveFocus();
  });

  it('una rama sin upstream elige remoto antes de publicarse', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const snapshot = await ports.git.readRefs('gitthul');
    const withoutUpstream = {
      ...snapshot,
      branches: snapshot.branches.map((branch) =>
        branch.kind === 'local' && branch.isHead ? { ...branch, upstream: undefined } : branch,
      ),
    };
    const push = vi.fn<AppPorts['git']['push']>(() => Promise.resolve(withoutUpstream));
    renderApp({
      ...ports,
      git: { ...ports.git, readRefs: () => Promise.resolve(withoutUpstream), push },
    });
    await openRepo(user, GITTHUL_PATH);

    await user.click(await screen.findByRole('button', { name: 'Hacer push' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publicar main' });
    await user.selectOptions(within(dialog).getByLabelText('Remoto'), 'origin');
    await user.click(within(dialog).getByRole('button', { name: 'Publicar main' }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledTimes(1);
    });
    expect(push.mock.calls[0]?.slice(0, 2)).toEqual(['gitthul', 'main']);
    expect(push.mock.calls[0]?.[2]).toMatchObject({ remote: 'origin', setUpstream: true });
    expect(push.mock.calls[0]?.[3]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('un fallo de autenticación no ofrece el enlace antiguo de credenciales', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const push = vi
      .fn<AppPorts['git']['push']>()
      .mockRejectedValue(new GitOperationError('auth.failed', { remote: 'origin' }));
    renderApp({ ...ports, git: { ...ports.git, push } });
    await openRepo(user, GITTHUL_PATH);

    await user.click(await screen.findByRole('button', { name: 'Hacer push' }));
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('No se pudo autenticar con origin');
    expect(within(toast).queryByRole('button', { name: /credenciales/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('el rechazo solo ofrece fuerza con la punta remota observada', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const snapshot = await ports.git.readRefs('gitthul');
    const observed = snapshot.branches.find((branch) => branch.name === 'origin/main')?.tip;
    expect(observed).toBeDefined();
    const push = vi
      .fn<AppPorts['git']['push']>()
      .mockRejectedValueOnce(
        new GitOperationError('push.rejected', { branch: 'main', remote: 'origin', count: 1 }),
      )
      .mockResolvedValue(snapshot);
    renderApp({ ...ports, git: { ...ports.git, push } });
    await openRepo(user, GITTHUL_PATH);

    await user.click(await screen.findByRole('button', { name: 'Hacer push' }));
    const dialog = await screen.findByRole('dialog', {
      name: /Se rechazó el push de main/,
    });
    await user.click(
      within(dialog).getByRole('button', { name: 'Hacer push con --force-with-lease' }),
    );

    await waitFor(() => {
      expect(push).toHaveBeenCalledTimes(2);
    });
    expect(push.mock.calls[1]?.slice(0, 2)).toEqual(['gitthul', 'main']);
    expect(push.mock.calls[1]?.[2]).toMatchObject({ expectedRemoteTip: observed });
    expect(push.mock.calls[1]?.[3]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('un pull inmediato conserva un cuadro de progreso y devuelve el foco antes del éxito', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const pull = vi.fn(() =>
      Promise.resolve({ strategy: 'rebase' as const, reason: 'unpublished' as const, received: 0 }),
    );
    renderApp({ ...ports, git: { ...ports.git, pull } });
    await openRepo(user, GITTHUL_PATH);

    const pullButton = await screen.findByRole('button', { name: 'Hacer pull' });
    await user.click(pullButton);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(pullButton).toHaveFocus();
    expect(screen.getByText('Pull con rebase (commits no publicados)')).toBeInTheDocument();
  });

  it('pinta sin reinterpretar el contrato que entrega el status nativo', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const nativeStatus: WorkingStatus = {
      staged: [
        {
          path: 'src/nombre nuevo.ts',
          previousPath: 'src/nombre anterior.ts',
          change: 'renamed',
          binary: false,
          insertions: 2,
          deletions: 1,
        },
      ],
      unstaged: [
        {
          path: 'docs/eliminado.md',
          change: 'deleted',
          binary: false,
          insertions: 0,
          deletions: 8,
        },
        {
          path: 'sin seguir.txt',
          change: 'untracked',
          binary: false,
          insertions: 0,
          deletions: 0,
        },
      ],
      conflicted: [],
      clean: false,
    };
    const integrated: AppPorts = {
      ...ports,
      git: { ...ports.git, readStatus: () => Promise.resolve(nativeStatus) },
    };

    renderApp(integrated);
    await openRepo(user, GITTHUL_PATH);

    const tracking = await screen.findByRole('region', { name: 'Cambios' });
    const stage = screen.getByRole('region', { name: 'Staging' });
    expect(within(stage).getByText('nombre nuevo.ts')).toBeInTheDocument();
    expect(within(stage).queryByText('+2')).not.toBeInTheDocument();
    expect(within(tracking).getByText('eliminado.md')).toBeInTheDocument();
    expect(within(tracking).getByText('sin seguir.txt')).toBeInTheDocument();
  });

  it('un repositorio recién creado enseña la rama inicial en Locales y el resto vacío', async () => {
    const ports = makePorts();
    const created = await ports.git.createRepository('/home/example/projects/nuevo', {
      name: 'nuevo',
      initialBranch: 'main',
    });

    renderApp(ports);

    useShellStore.getState().openWorking({
      repoId: created.id,
      repoName: created.name,
      repoPath: created.path,
      branch: created.head,
    });

    const panel = await screen.findByRole('region', { name: 'Referencias de nuevo' });

    // Sin commits todavía no hay un objeto `Branch`, pero `HEAD` ya nombra la
    // rama inicial y Locales la enseña igual — sección 3 del subplan.
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });

    expect(
      within(panel).getByRole('button', { name: 'Plegar Ramas locales' }).textContent,
    ).toContain('1');
    expect(within(locals).getByText('main')).toBeInTheDocument();

    expect(within(panel).getByText('Sin remotos todavía')).toBeInTheDocument();
    expect(within(panel).getByText('Sin tags todavía')).toBeInTheDocument();
    expect(within(panel).getByText('Sin stashes')).toBeInTheDocument();

    // Sin commits y con el árbol limpio, la tabla enseña el vacío de CU-2 en
    // vez de una rejilla sin nada dentro.
    expect(await screen.findByText('Todavía no hay ningún commit')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('los guardados salen arriba del historial con su mensaje', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });

    // El mensaje del stash se muestra directamente (editable inline).
    expect(
      within(grid).getAllByText(/WIP: pruebas del motor de calles a medias/).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('un clic en una referencia selecciona también su fila del grafo', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    const branch = refs.branches.find(
      (candidate) => candidate.kind === 'local' && !candidate.isHead,
    );
    if (!branch) throw new Error('El fixture debe tener una rama local inactiva');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });

    await user.click(within(locals).getByText(branch.name.split('/').at(-1) ?? branch.name));

    expect(useWorkingStore.getState().selectedCommits).toEqual(new Set([branch.tip]));
  });

  it('las flechas recorren y seleccionan ramas y tags del panel de referencias', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('tree', { name: 'Ramas locales' });

    locals.focus();
    await user.keyboard('{End}');

    expect(useWorkingStore.getState().selectedRef?.kind).toBe('localBranch');

    const tags = within(panel).getByRole('tree', { name: 'Tags' });

    tags.focus();
    await user.keyboard('{End}');

    expect(useWorkingStore.getState().selectedRef?.kind).toBe('tag');
  });

  it('las flechas atraviesan carpetas de ramas sin volver a la última hoja', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    const remoteBranches = refs.branches.filter((branch) => branch.kind === 'remote');
    const local = (id: string, name: string, isHead = false) => ({
      id,
      name,
      kind: 'local' as const,
      tip: refs.head.sha,
      ahead: 0,
      behind: 0,
      isHead,
    });

    vi.spyOn(ports.git, 'readRefs').mockResolvedValue({
      ...refs,
      branches: [
        local('refs/heads/feature/one', 'feature/one'),
        local('refs/heads/feature/two', 'feature/two'),
        local('refs/heads/fix/three', 'fix/three'),
        local('refs/heads/main', 'main', true),
        ...remoteBranches,
      ],
    });

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('tree', { name: 'Ramas locales' });

    fireEvent.mouseDown(within(locals).getByRole('treeitem', { name: 'two' }), { button: 0 });
    locals.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');

    expect(useWorkingStore.getState().selectedRef).toMatchObject({
      kind: 'localBranch',
      name: 'fix/three',
    });
  });

  it('las flechas conservan el foco en los archivos mientras cambian el diff', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const commit = (await ports.git.readCommits('gitthul', { limit: 1 })).commits[0];

    if (!commit) throw new Error('El fixture necesita al menos un commit');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const commitRow = within(grid).getByText(commit.summary).closest<HTMLElement>('[role="row"]');

    if (!commitRow) throw new Error('No se encontró la fila del commit');

    fireEvent.mouseDown(commitRow, { button: 0 });
    const details = await screen.findByRole('region', {
      name: `Detalles del commit ${shortSha(commit.sha)}`,
    });
    const files = within(details).getByRole('listbox');

    expect(within(files).getAllByRole('option').length).toBeGreaterThan(1);
    files.focus();
    await user.keyboard('{ArrowDown}{ArrowUp}');

    expect(files).toHaveFocus();
    expect(within(files).getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: /^Diff de / })).toBeVisible();
  });

  it('seleccionar un guardado en el panel muestra sus archivos incluidos', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    const stash = refs.stashes[0];
    if (!stash) throw new Error('El fixture debe tener un guardado');
    const details = await ports.git.readCommit('gitthul', stash.sha);

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const stashes = within(panel).getByRole('group', { name: 'Stashes' });

    await user.click(within(stashes).getByText(new RegExp(stash.message)));

    expect(useWorkingStore.getState().selectedCommits).toEqual(
      new Set([`stash:${String(stash.index)}`]),
    );
    const stashPanel = await screen.findByRole('region', {
      name: `Detalles del commit ${stash.sha.slice(0, 7)}`,
    });
    expect(stashPanel).toBeInTheDocument();
    expect(within(stashPanel).queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    expect(within(stashPanel).queryByText(/^−\d+$/)).not.toBeInTheDocument();
    for (const file of details.files) {
      expect(screen.getByText(file.path.split('/').at(-1) ?? file.path)).toBeInTheDocument();
    }
  });

  it('abre el archivo sin seguimiento guardado usando el origen del stash', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const untracked = (await ports.git.readStatus('gitthul')).unstaged.find(
      (file) => file.change === 'untracked',
    );
    if (!untracked) throw new Error('El fixture necesita un archivo sin seguimiento');
    const readDiff = vi.spyOn(ports.git, 'readDiff');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('region', { name: 'Cambios' });
    await user.click(screen.getByRole('button', { name: 'Crear stash' }));
    await waitFor(() => expect(useWorkingStore.getState().pendingWrites).toBe(0));
    const stash = (await ports.git.readRefs('gitthul')).stashes[0]!;
    const panel = await screen.findByRole('region', {
      name: `Detalles del commit ${stash.sha.slice(0, 7)}`,
    });
    await user.dblClick(within(panel).getByText(untracked.path.split('/').at(-1)!));
    expect(await screen.findByRole('region', { name: /^Diff de / })).toBeVisible();
    expect(useWorkingStore.getState().diff?.source).toEqual({ kind: 'stash', sha: stash.sha });
    expect(readDiff).toHaveBeenCalledWith(
      'gitthul',
      expect.objectContaining({ path: untracked.path, source: { kind: 'stash', sha: stash.sha } }),
      expect.anything(),
    );
    await screen.findByText(`En el stash ${stash.sha.slice(0, 7)}`);
  });

  it('descartar un guardado exige confirmar el mismo OID que mostró la fila', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    const stash = refs.stashes[0];
    if (!stash) throw new Error('El fixture debe tener un guardado');
    const dropStash = vi.spyOn(ports.git, 'dropStash');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const row = within(grid).getAllByText(stash.message)[0]?.closest<HTMLElement>('[role="row"]');
    if (!row) throw new Error('La tabla no montó el guardado');

    fireEvent.contextMenu(row);
    await user.click(
      await screen.findByRole('menuitem', { name: `Eliminar stash ${stash.message}` }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: `Eliminar stash ${stash.message}`,
    });
    await user.click(
      within(dialog).getByRole('button', { name: `Eliminar stash ${stash.message}` }),
    );

    await waitFor(() => expect(dropStash).toHaveBeenCalledOnce());
    expect(dropStash).toHaveBeenCalledWith('gitthul', 0, { expectedStash: stash.sha });
  });

  it('si falla la primera página de commits, Reintentar la vuelve a pedir', async () => {
    const user = userEvent.setup();
    const ports = makePorts();

    // `unknown` es el único código que ofrece Reintentar sin pedir ningún otro
    // parámetro — el catálogo de arreglos lo decide `describeError`, no el
    // componente.
    const failure = new GitOperationError('unknown', {});

    let attempts = 0;

    const flaky: AppPorts = {
      ...ports,
      git: {
        ...ports.git,
        readCommits: (id, page, query) => {
          // El límite de 500 es el de `CommitTable` — la Repositorios home y
          // `RepoStatsPanel` piden con otros límites, y no deben gastarse el
          // único fallo programado.
          if (id === 'gitthul' && page?.limit === 500 && attempts === 0) {
            attempts += 1;

            return Promise.reject(failure);
          }

          return ports.git.readCommits(id, page, query);
        },
      },
    };

    renderApp(flaky);
    await openRepo(user, GITTHUL_PATH);

    // El panel izquierdo sí carga bien — solo la tabla de commits falló.
    await screen.findByRole('region', { name: 'Referencias de gitthul' });

    const retry = await screen.findByRole('button', { name: 'Reintentar' });

    await user.click(retry);

    expect(await screen.findByRole('grid', { name: 'Commits de gitthul' })).toBeInTheDocument();
  });

  it('pagina sin repetir un salto anterior ni devolver el scroll hacia arriba', async () => {
    const user = userEvent.setup();
    const ports = makePorts();

    const total = 600;
    const synthetic: Commit[] = Array.from({ length: total }, (_, index) => ({
      sha: `synthetic-${String(index)}`,
      parents: [],
      summary: `Commit sintético ${String(index)}`,
      body: '',
      author: { name: 'Alex', email: 'alex@example.org' },
      authoredAt: index,
      committer: { name: 'Alex', email: 'alex@example.org' },
      committedAt: index,
    }));

    const requests: Array<CommitPageRequest | undefined> = [];

    const paginated: AppPorts = {
      ...ports,
      git: {
        ...ports.git,
        readCommits: (id, page) => {
          // Solo se intercepta la página de 500 de `CommitTable`: Repositorios
          // pide con otros límites para su propia lista y su mapa de calor, y
          // esas peticiones no deberían mezclarse con las de esta prueba.
          if (id !== 'gitthul' || page?.limit !== 500) return ports.git.readCommits(id, page);

          requests.push(page);

          const skip = page?.skip ?? 0;
          const limit = page.limit;
          const slice = synthetic.slice(skip, skip + limit);

          return Promise.resolve({ commits: slice, total, hasMore: skip + slice.length < total });
        },
      },
    };

    renderApp(paginated);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    // `DataGrid` tiene dos `rowgroup`: la cabecera fija y el cuerpo
    // virtualizado, que es el que de verdad scrollea — el segundo.
    const [, rowgroup] = within(grid).getAllByRole('rowgroup');

    if (!rowgroup) throw new Error('La tabla no montó el cuerpo virtualizado');

    expect(requests).toEqual([{ limit: 500 }]);

    const scrollTo = vi.fn();

    Object.defineProperty(rowgroup, 'scrollTo', { value: scrollTo, configurable: true });

    act(() => {
      useWorkingStore.getState().requestGoTo('synthetic-0');
    });

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledTimes(1);
    });

    Object.defineProperty(rowgroup, 'scrollTop', { value: 100_000, configurable: true });
    fireEvent.scroll(rowgroup);

    await waitFor(() => {
      expect(requests).toContainEqual({ skip: 500, limit: 500 });
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('mientras carga enseña el esqueleto de las cinco secciones', async () => {
    const user = userEvent.setup();

    const ports = makePorts();
    let finishLoading!: () => void;
    const loading = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });
    renderApp({
      ...ports,
      git: {
        ...ports.git,
        readRefs: async (id, query) => {
          await loading;
          return ports.git.readRefs(id, query);
        },
      },
    });
    await openRepo(user, GITTHUL_PATH);

    expect(
      await screen.findByRole('status', { name: 'Leyendo las referencias' }),
    ).toBeInTheDocument();
    act(() => finishLoading());
    expect(
      await screen.findByRole('region', { name: 'Referencias de gitthul' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Leyendo las referencias' })).toBeNull(),
    );
  });

  it('un repositorio que ya no está ofrece Localizar y Olvidar, y Olvidar cierra la pestaña', async () => {
    const user = userEvent.setup();
    const ports = makePorts();

    const notFound = new GitOperationError('repo.notFound', {
      repo: 'gitthul',
      path: GITTHUL_PATH,
    });

    const broken: AppPorts = {
      ...ports,
      git: {
        ...ports.git,
        readRepository: (id, query) =>
          id === 'gitthul' ? Promise.reject(notFound) : ports.git.readRepository(id, query),
      },
    };

    renderApp(broken);
    await openRepo(user, GITTHUL_PATH);

    // Abrir de verdad encadena `markOpened`, recargar la lista de repositorios
    // en segundo plano y montar `WorkingView`; ese último tramo deja la
    // ventana con un repintado adicional justo detrás del primero que ya
    // enseña el panel de error, así que se espera a que se asiente antes de
    // consultar el texto — `findByText` a secas podía atrapar una referencia
    // que un repintado inmediatamente posterior dejaba fuera del documento.
    await screen.findByText('La carpeta de gitthul ya no está donde estaba');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText('La carpeta de gitthul ya no está donde estaba')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Buscar gitthul en otra carpeta' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Olvidar gitthul en GitThul' }));

    // Olvidar de verdad quita el repositorio y cierra la pestaña que ya no
    // tenía dónde apuntar: se vuelve al hogar.
    expect(useShellStore.getState().tabs).toEqual([]);
    expect(await screen.findAllByRole('option')).not.toHaveLength(0);
  });

  it('las etiquetas de rama y tag salen sobre el nodo del commit al que apuntan', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });

    // `main` y `origin/main` no comparten commit en el fixture —la local va
    // siete commits por delante—, así que la etiqueta de la punta es la de la
    // rama activa, con su icono relleno y su título de rama activa.
    expect(within(grid).getByTitle('Rama activa main')).toBeInTheDocument();
  });

  it('el doble clic en un chip del grafo ejecuta el checkout tipado', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const checkout = vi.spyOn(ports.git, 'checkout');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });

    await user.dblClick(within(grid).getByTitle('Rama activa main'));

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        'gitthul',
        { kind: 'branch', name: 'main' },
        { autoStash: true },
      );
    });
  });

  it('el chip de una rama exclusivamente remota crea su copia local y cambia a ella', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const beforeDelete = await ports.git.readRefs('gitthul');
    const previousLocal = beforeDelete.branches.find(
      (branch) => branch.kind === 'local' && branch.name === 'dev',
    );
    expect(previousLocal).toBeDefined();
    const initial = await ports.git.deleteBranch('gitthul', 'dev', {
      force: true,
      expectedTip: previousLocal?.tip,
    });
    const local = initial.branches.find(
      (branch) => branch.kind === 'local' && branch.name === 'dev',
    );
    const remote = initial.branches.find(
      (branch) => branch.kind === 'remote' && branch.name === 'origin/dev',
    );
    const checkout = vi.spyOn(ports.git, 'checkout');

    expect(local).toBeUndefined();
    expect(remote).toBeDefined();

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    await user.dblClick(within(grid).getByTitle('Rama remota dev'));

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        'gitthul',
        { kind: 'remoteBranch', name: 'origin/dev', remote: 'origin' },
        {
          autoStash: true,
          remoteMode: 'fastForward',
          expectedRemoteTip: remote?.tip,
        },
      );
    });

    const aligned = await ports.git.readRefs('gitthul');
    expect(aligned.head).toMatchObject({ branch: 'dev', detached: false, sha: remote?.tip });
    expect(aligned.branches.find((branch) => branch.name === 'dev')).toMatchObject({
      tip: remote?.tip,
      upstream: 'origin/dev',
      ahead: 0,
      behind: 0,
    });
  });

  it('el chip remoto pide una decisión antes de reemplazar una local adelantada', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const initial = await ports.git.readRefs('gitthul');
    const local = initial.branches.find(
      (branch) => branch.kind === 'local' && branch.name === 'main',
    );
    const remote = initial.branches.find(
      (branch) => branch.kind === 'remote' && branch.name === 'origin/main',
    );
    const checkout = vi.spyOn(ports.git, 'checkout');

    expect(local?.ahead).toBeGreaterThan(0);
    expect(remote).toBeDefined();

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    await user.dblClick(within(grid).getByTitle('Rama remota main'));

    const dialog = await screen.findByRole('dialog', {
      name: 'main tiene commits locales propios',
    });
    expect(within(dialog).getByRole('button', { name: 'No hacer nada' })).toBeEnabled();
    expect(
      within(dialog).getByRole('button', { name: 'Crear otra rama desde la remota' }),
    ).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: 'Alinear main con la remota' }));

    await waitFor(() => {
      expect(checkout).toHaveBeenCalledWith(
        'gitthul',
        { kind: 'remoteBranch', name: 'origin/main', remote: 'origin' },
        {
          autoStash: true,
          remoteMode: 'reset',
          expectedLocalTip: local?.tip,
          expectedRemoteTip: remote?.tip,
        },
      );
    });

    const aligned = await ports.git.readRefs('gitthul');
    expect(aligned.head).toMatchObject({ branch: 'main', detached: false, sha: remote?.tip });
  });

  it('arrastra una etiqueta del grafo hasta una rama remota del panel con su nombre completo', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const tree = within(panel).getByRole('tree', { name: 'Ramas remotas' });
    const source = within(grid).getByTitle('Rama activa main');
    const target = within(tree).getByText('dev');

    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(await screen.findByRole('dialog', { name: 'Comparar' })).toBeInTheDocument();
  });

  it('clic derecho sobre una rama local abre su menú, con lo de otras fases deshabilitado', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });

    fireEvent.contextMenu(within(locals).getByText('dev'));

    const menu = await screen.findByRole('menu', { name: 'Acciones de dev' });

    expect(within(menu).getByRole('menuitem', { name: 'Cambiar a dev' })).toBeEnabled();
    expect(within(menu).getByRole('menuitem', { name: 'Crear un worktree con dev' })).toBeEnabled();

    // Las entradas de fases futuras existen con su rótulo entero y no disparan
    // nada — mismo criterio que los siete botones de `GitActionBar`.
    // Desde F2.7, fusionar y rebasar ya funcionan; publicar sigue en F2.9.
    expect(
      within(menu).getByRole('menuitem', { name: 'Hacer merge de dev en main' }),
    ).toBeEnabled();
    expect(within(menu).getByRole('menuitem', { name: 'Publicar dev en origin' })).toBeDisabled();
  });

  it('la búsqueda usa la rama señalada como origen de una vista previa', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });

    await user.click(within(locals).getByText('dev'));
    await user.keyboard('{Control>}p{/Control}');
    const palette = screen.getByRole('dialog', { name: 'Búsqueda global' });
    await user.type(within(palette).getByRole('combobox'), 'merge');
    await user.click(await within(palette).findByRole('option', { name: /^Hacer merge en main/ }));

    expect(await screen.findByRole('dialog', { name: 'Merge de dev en main' })).toBeInTheDocument();
  });

  it('recupera una posición de HEAD en una rama nueva sin cambiarse a ella', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const recover = vi.spyOn(ports.git, 'recoverReflogEntry');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await user.keyboard('{Control>}p{/Control}');
    const palette = screen.getByRole('dialog', { name: 'Búsqueda global' });
    await user.type(within(palette).getByRole('combobox'), 'recuperar');
    await user.click(
      await within(palette).findByRole('option', { name: /^Recuperar una posición anterior/ }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Recuperar una posición anterior' });
    const name = within(dialog).getByLabelText('Nombre de la rama de recuperación');
    await user.clear(name);
    await user.type(name, 'rescate-seguro');
    await user.click(within(dialog).getByRole('button', { name: 'Crear la rama de recuperación' }));

    await waitFor(() => {
      expect(recover).toHaveBeenCalledWith(
        expect.any(String),
        'rescate-seguro',
        'HEAD@{0}',
        expect.stringMatching(/^[0-9a-f]{40}$/),
      );
    });
    expect((await screen.findAllByText('rescate-seguro')).length).toBeGreaterThan(0);

    const undo = screen.getByRole('button', { name: 'Deshacer' });
    await waitFor(() => {
      expect(undo).toBeEnabled();
    });
    await user.click(undo);
    await waitFor(() => {
      expect(screen.queryByText('rescate-seguro')).not.toBeInTheDocument();
    });
  });

  it('confirmar la vista previa entrega a merge las dos puntas observadas', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const merge = vi.spyOn(ports.git, 'merge');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });
    fireEvent.contextMenu(within(locals).getByText('dev'));
    await user.click(
      within(await screen.findByRole('menu', { name: 'Acciones de dev' })).getByRole('menuitem', {
        name: 'Hacer merge de dev en main',
      }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Merge de dev en main',
    });
    const confirm = within(dialog).getByRole('button', { name: 'Hacer merge de dev en main' });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(merge).toHaveBeenCalledOnce());
    expect(merge.mock.calls[0]?.[0]).toBe('gitthul');
    expect(merge.mock.calls[0]?.[1]).toBe('dev');
    const precondition = merge.mock.calls[0]?.[2]?.precondition;
    expect(precondition?.sourceRef).toBe('dev');
    expect(precondition?.targetRef).toBe('main');
    expect(precondition?.sourceOid).toMatch(/^[0-9a-f]{40}$/);
    expect(precondition?.targetOid).toMatch(/^[0-9a-f]{40}$/);
  });

  it('confirmar cherry-pick conserva el SHA y la punta de main que mostró el diálogo', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const cherryPick = vi.spyOn(ports.git, 'cherryPick');
    const expectedHead = (await ports.git.readRefs('gitthul')).head.sha;

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const commitRow = within(grid)
      .getByText('F0.7: shell, barra inferior y máquina de pestañas')
      .closest<HTMLElement>('[role="row"]');
    if (!commitRow) throw new Error('La tabla no montó un commit');
    const short = within(commitRow).getByText(/^[0-9a-f]{7}$/).textContent ?? '';

    fireEvent.contextMenu(commitRow);
    await user.click(
      await screen.findByRole('menuitem', { name: `Hacer cherry-pick de ${short} sobre main` }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Hacer cherry-pick de 1 commits sobre main',
    });
    const confirm = within(dialog).getByRole('button', {
      name: 'Hacer cherry-pick de 1 commits sobre main',
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(cherryPick).toHaveBeenCalledOnce());
    const [repoId, shas, options] = cherryPick.mock.calls[0] ?? [];
    expect(repoId).toBe('gitthul');
    expect(shas).toHaveLength(1);
    expect(shas?.[0]?.slice(0, 7)).toBe(short);
    expect(options?.precondition).toEqual({ targetRef: 'main', targetOid: expectedHead });
  });

  it('confirmar revert conserva el SHA y la punta de main que mostró el diálogo', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const revert = vi.spyOn(ports.git, 'revert');
    const expectedHead = (await ports.git.readRefs('gitthul')).head.sha;

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const commitRow = within(grid)
      .getByText('F0.7: shell, barra inferior y máquina de pestañas')
      .closest<HTMLElement>('[role="row"]');
    if (!commitRow) throw new Error('La tabla no montó un commit');
    const short = within(commitRow).getByText(/^[0-9a-f]{7}$/).textContent ?? '';

    fireEvent.contextMenu(commitRow);
    await user.click(await screen.findByRole('menuitem', { name: `Revertir ${short} en main` }));
    const dialog = await screen.findByRole('dialog', { name: 'Revertir 1 commits en main' });
    const confirm = within(dialog).getByRole('button', { name: 'Revertir 1 commits en main' });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(() => expect(revert).toHaveBeenCalledOnce());
    const [repoId, shas, options] = revert.mock.calls[0] ?? [];
    expect(repoId).toBe('gitthul');
    expect(shas).toHaveLength(1);
    expect(shas?.[0]?.slice(0, 7)).toBe(short);
    expect(options?.precondition).toEqual({ targetRef: 'main', targetOid: expectedHead });
  });

  it('un merge exige elegir padre y entrega esa línea principal al cherry-pick', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const merge = (await ports.git.readCommits('gitthul', { limit: 20 })).commits.find(isMerge);
    if (!merge) throw new Error('El primer tramo del fixture debe contener un merge');
    const cherryPick = vi.spyOn(ports.git, 'cherryPick');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const commitRow = within(grid).getByText(merge.summary).closest<HTMLElement>('[role="row"]');
    if (!commitRow) throw new Error('La tabla no montó el merge');
    const short = within(commitRow).getByText(/^[0-9a-f]{7}$/).textContent ?? '';

    fireEvent.contextMenu(commitRow);
    await user.click(
      await screen.findByRole('menuitem', { name: `Hacer cherry-pick de ${short} sobre main` }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Hacer cherry-pick de 1 commits sobre main',
    });
    const confirm = within(dialog).getByRole('button', {
      name: 'Hacer cherry-pick de 1 commits sobre main',
    });
    expect(confirm).toBeDisabled();

    await user.click(await within(dialog).findByRole('radio', { name: /^Padre 2 ·/ }));
    await user.click(confirm);

    await waitFor(() => expect(cherryPick).toHaveBeenCalledOnce());
    expect(cherryPick.mock.calls[0]?.[2]?.mainline).toBe(2);
  });

  it('confirmar reset conserva la rama y el estado que mostró el diálogo', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const reset = vi.spyOn(ports.git, 'reset');
    const expectedHead = (await ports.git.readRefs('gitthul')).head.sha;

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const commitRow = within(grid)
      .getByText('F0.7: shell, barra inferior y máquina de pestañas')
      .closest<HTMLElement>('[role="row"]');
    if (!commitRow) throw new Error('La tabla no montó un commit');
    const short = within(commitRow).getByText(/^[0-9a-f]{7}$/).textContent ?? '';

    fireEvent.contextMenu(commitRow);
    const resetMenu = await screen.findByRole('menuitem', {
      name: `Hacer reset de main a ${short}…`,
    });
    await user.click(resetMenu);
    const dialog = await screen.findByRole('dialog', {
      name: `Hacer reset de main a ${short}`,
    });
    await user.click(within(dialog).getByRole('button', { name: 'Hacer reset' }));

    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
    const [repoId, sha, mode, options] = reset.mock.calls[0] ?? [];
    expect(repoId).toBe('gitthul');
    expect(sha?.slice(0, 7)).toBe(short);
    expect(mode).toBe('soft');
    expect(options).toEqual({
      expectedBranch: 'main',
      precondition: { head: expectedHead, indexTree: null, worktreeTree: null },
    });
  });

  it('crear una rama desde el menú de otra la deja en Locales', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });

    fireEvent.contextMenu(within(locals).getByText('dev'));
    await user.click(await screen.findByRole('menuitem', { name: 'Crear una rama desde dev' }));

    const dialog = await screen.findByRole('dialog', { name: 'Crear una rama desde dev' });

    await user.type(within(dialog).getByLabelText('Nombre de la rama'), 'f2-4-etiquetas');
    await user.click(within(dialog).getByRole('button', { name: 'Crear la rama' }));

    expect(await screen.findByText('Se creó la rama f2-4-etiquetas')).toBeInTheDocument();

    const updated = within(
      await screen.findByRole('region', { name: 'Referencias de gitthul' }),
    ).getByRole('group', { name: 'Ramas locales' });

    expect(within(updated).getByText('f2-4-etiquetas')).toBeInTheDocument();
    expect(
      within(
        screen.getByRole('button', { name: 'Plegar el panel de referencias: gitthul' }),
      ).getByText('f2-4-etiquetas'),
    ).toBeInTheDocument();

    const undo = screen.getByRole('button', { name: 'Deshacer' });
    await user.click(undo);
    expect(
      await within(
        screen.getByRole('button', { name: 'Plegar el panel de referencias: gitthul' }),
      ).findByText('main'),
    ).toBeInTheDocument();
    expect(within(updated).getByText('f2-4-etiquetas')).toBeInTheDocument();

    await user.click(undo);
    await waitFor(() => {
      expect(within(updated).queryByText('f2-4-etiquetas')).not.toBeInTheDocument();
    });

    const redo = screen.getByRole('button', { name: 'Rehacer' });
    await user.click(redo);
    expect(await within(updated).findByText('f2-4-etiquetas')).toBeInTheDocument();
    await user.click(redo);
    expect(
      await within(
        screen.getByRole('button', { name: 'Plegar el panel de referencias: gitthul' }),
      ).findByText('f2-4-etiquetas'),
    ).toBeInTheDocument();
  });

  it('el aviso de creación bloqueada explica que debe hacerse stash o commit primero', async () => {
    const user = userEvent.setup();
    const git = createMockGitPort({ latency: NO_LATENCY });
    const ports = { ...makePorts(), git };
    const before = {
      refs: await git.readRefs('gitthul'),
      status: await git.readStatus('gitthul'),
      undo: await git.readUndoStack('gitthul'),
    };
    git.failNext(
      'createBranch',
      new GitOperationError(
        'branch.checkoutBlocked',
        { branch: 'pendiente' },
        {
          output:
            'error: Your local changes would be overwritten by checkout. Please commit your changes or stash them before you switch branches.',
        },
      ),
    );
    const createBranch = vi.spyOn(git, 'createBranch');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('region', { name: 'Referencias de gitthul' });
    act(() =>
      useWorkingStore.getState().openDialog({
        kind: 'createBranch',
        from: { kind: 'branch', name: 'dev' },
        fromLabel: 'dev',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Crear una rama desde dev' });
    await user.type(within(dialog).getByLabelText('Nombre de la rama'), 'pendiente');
    await user.click(within(dialog).getByRole('button', { name: 'Crear la rama' }));

    const message =
      'Cambiar a pendiente sobrescribiría archivos locales. Crea un stash o haz commit primero';
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(createBranch).toHaveBeenCalledWith(
      'gitthul',
      'pendiente',
      { kind: 'branch', name: 'dev' },
      { checkout: true },
    );
    expect(await git.readRefs('gitthul')).toEqual(before.refs);
    expect(await git.readStatus('gitthul')).toEqual(before.status);
    expect(await git.readUndoStack('gitthul')).toEqual(before.undo);

    act(() => useShellStore.getState().setOverlay('notifications'));
    const history = await screen.findByRole('dialog', { name: 'Historial de notificaciones' });
    expect(within(history).getByText(message)).toBeVisible();
  });

  it('el aviso de checkout bloqueado explica la colisión sin afirmar que se creó una rama', async () => {
    const user = userEvent.setup();
    const git = createMockGitPort({ latency: NO_LATENCY });
    const ports = { ...makePorts(), git };
    const before = {
      refs: await git.readRefs('gitthul'),
      status: await git.readStatus('gitthul'),
      undo: await git.readUndoStack('gitthul'),
    };
    git.failNext(
      'checkout',
      new GitOperationError(
        'branch.checkoutBlocked',
        { branch: 'dev' },
        {
          output:
            'error: The following untracked working tree files would be overwritten by checkout:',
        },
      ),
    );
    const checkout = vi.spyOn(git, 'checkout');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });
    fireEvent.contextMenu(within(locals).getByText('dev'));
    await user.click(await screen.findByRole('menuitem', { name: 'Cambiar a dev' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cambiar a dev sobrescribiría archivos locales. Crea un stash o haz commit primero',
    );
    expect(checkout).toHaveBeenCalledWith(
      'gitthul',
      { kind: 'branch', name: 'dev' },
      { autoStash: true },
    );
    expect(await git.readRefs('gitthul')).toEqual(before.refs);
    expect(await git.readStatus('gitthul')).toEqual(before.status);
    expect(await git.readUndoStack('gitthul')).toEqual(before.undo);
  });

  it('renombra una rama y recorre el cambio por Deshacer y Rehacer', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });
    fireEvent.contextMenu(within(locals).getByText('dev'));
    await user.click(await screen.findByRole('menuitem', { name: 'Renombrar dev' }));

    const dialog = await screen.findByRole('dialog', { name: 'Renombrar la rama dev' });
    const input = within(dialog).getByLabelText('Nombre de la rama');
    await user.clear(input);
    await user.type(input, 'desarrollo');
    await user.click(within(dialog).getByRole('button', { name: 'Renombrar' }));

    expect(await within(locals).findByText('desarrollo')).toBeInTheDocument();
    expect(within(locals).queryByText('dev')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(await within(locals).findByText('dev')).toBeInTheDocument();
    expect(within(locals).queryByText('desarrollo')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rehacer' }));
    expect(await within(locals).findByText('desarrollo')).toBeInTheDocument();
    expect(within(locals).queryByText('dev')).not.toBeInTheDocument();
  });

  it('edita y quita un remoto desde su fila con precondiciones visibles', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    let panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    let tree = within(panel).getByRole('tree', { name: 'Ramas remotas' });
    fireEvent.contextMenu(within(tree).getByText('origin'));
    await user.click(await screen.findByRole('menuitem', { name: 'Editar origin' }));

    const edit = await screen.findByRole('dialog', { name: 'Editar el remoto origin' });
    const name = within(edit).getByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'upstream');
    await user.click(within(edit).getByRole('button', { name: 'Guardar remoto' }));

    expect(await screen.findByText('Se actualizó el remoto upstream')).toBeInTheDocument();
    panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    tree = within(panel).getByRole('tree', { name: 'Ramas remotas' });
    fireEvent.contextMenu(within(tree).getByText('upstream'));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar upstream' }));

    const remove = await screen.findByRole('dialog', { name: 'Quitar el remoto upstream' });
    expect(within(remove).getByText(/El repositorio del servidor se conserva/)).toBeVisible();
    await user.click(within(remove).getByRole('button', { name: 'Quitar upstream' }));

    expect(await screen.findByText('Se quitó el remoto upstream')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('upstream')).not.toBeInTheDocument();
    });
  });

  it('un segundo commit con Ctrl deja los dos marcados, y el mismo clic dos veces desmarca', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const [firstCommit, secondCommit] = (await ports.git.readCommits('gitthul', { limit: 2 }))
      .commits;

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const first = firstCommit
      ? within(grid).getByText(firstCommit.summary).closest<HTMLElement>('[role="row"]')
      : null;
    const second = secondCommit
      ? within(grid).getByText(secondCommit.summary).closest<HTMLElement>('[role="row"]')
      : null;

    if (!first || !second) throw new Error('La tabla no montó suficientes filas');

    // `VirtualList` selecciona en `mousedown`, así que la tecla modificadora
    // tiene que viajar en ese evento y no en el `click` de después.
    fireEvent.mouseDown(first, { button: 0 });
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.mouseDown(second, { button: 0, ctrlKey: true });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('region', { name: /^Comparar / })).toBeVisible();

    // Segundo clic sobre lo ya seleccionado a solas: deselecciona — CU-4.
    fireEvent.mouseDown(second, { button: 0, ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /^Comparar / })).not.toBeInTheDocument();
    });
    fireEvent.mouseDown(first, { button: 0 });

    expect(first).toHaveAttribute('aria-selected', 'false');
  });

  it('tres commits contiguos abren inmediatamente su diff combinado', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const commits = (await ports.git.readCommits('gitthul', { limit: 3 })).commits;

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const rows = commits.map((commit) =>
      within(grid).getByText(shortSha(commit.sha)).closest<HTMLElement>('[role="row"]'),
    );
    const [first, second, third] = rows;

    if (!first || !second || !third) throw new Error('La tabla no montó suficientes filas');

    fireEvent.mouseDown(first, { button: 0 });
    fireEvent.mouseDown(second, { button: 0, ctrlKey: true });
    fireEvent.mouseDown(third, { button: 0, ctrlKey: true });

    expect(
      await screen.findByRole('region', { name: /^Diff combinado de 3 commits/ }),
    ).toBeVisible();
  });

  it('tres commits no contiguos comparan inmediatamente sus extremos', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const commits = (await ports.git.readCommits('gitthul', { limit: 5 })).commits;
    const selected = [commits[0], commits[2], commits[4]];

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const rows = selected.map((commit) =>
      commit
        ? within(grid).getByText(shortSha(commit.sha)).closest<HTMLElement>('[role="row"]')
        : null,
    );
    const [newest, middle, oldest] = rows;

    if (!newest || !middle || !oldest || !selected[0] || !selected[2]) {
      throw new Error('La tabla no montó suficientes filas');
    }

    fireEvent.mouseDown(newest, { button: 0 });
    fireEvent.mouseDown(middle, { button: 0, ctrlKey: true });
    fireEvent.mouseDown(oldest, { button: 0, ctrlKey: true });

    expect(
      await screen.findByRole('region', {
        name: `Comparar ${shortSha(selected[2].sha)} con ${shortSha(selected[0].sha)}`,
      }),
    ).toBeVisible();
  });

  it('tres commits adyacentes de distintas líneas de historia comparan sus extremos', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const commits = (await ports.git.readCommits('gitthul', { limit: 3 })).commits;
    const [newest, branchTip, oldest] = commits;

    if (!newest || !branchTip || !oldest) throw new Error('El fixture necesita tres commits');

    // El merge aparece encima de su segundo padre; la fila adyacente no
    // continúa su primer padre y no forma una secuencia combinable con él.
    const readCommits = ports.git.readCommits;
    vi.spyOn(ports.git, 'readCommits').mockImplementation(async (repoId, page, query) => {
      const result = await readCommits(repoId, page, query);
      return {
        ...result,
        commits: result.commits.map((commit) =>
          commit.sha === newest.sha ? { ...commit, parents: [oldest.sha, branchTip.sha] } : commit,
        ),
      };
    });

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const rows = commits.map((commit) =>
      within(grid).getByText(shortSha(commit.sha)).closest<HTMLElement>('[role="row"]'),
    );
    const [first, second, third] = rows;

    if (!first || !second || !third) throw new Error('La tabla no montó suficientes filas');

    fireEvent.mouseDown(first, { button: 0 });
    fireEvent.mouseDown(second, { button: 0, ctrlKey: true });
    fireEvent.mouseDown(third, { button: 0, ctrlKey: true });

    expect(
      await screen.findByRole('region', {
        name: `Comparar ${shortSha(oldest.sha)} con ${shortSha(newest.sha)}`,
      }),
    ).toBeVisible();
    expect(useWorkingStore.getState().compare).toMatchObject({
      kind: 'refs',
      source: { ref: oldest.sha },
      target: { ref: newest.sha },
      trigger: 'selection',
    });
    expect(screen.queryByRole('region', { name: /^Diff combinado de 3 commits/ })).toBeNull();
  });

  it.each([
    ['commit y stash', 'commit-stash'],
    ['stash y WIP', 'stash-wip'],
    ['commit y WIP', 'commit-wip'],
  ] as const)('compara inmediatamente %s', async (_label, combination) => {
    const user = userEvent.setup();
    const ports = makePorts();
    const commit = (await ports.git.readCommits('gitthul', { limit: 1 })).commits[0];
    const stash = (await ports.git.readRefs('gitthul')).stashes[0];

    if (!commit || !stash) throw new Error('El fixture necesita un commit y un stash');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const commitRow = within(grid)
      .getByText(shortSha(commit.sha))
      .closest<HTMLElement>('[role="row"]');
    const stashRow = within(grid).getByText(stash.message).closest<HTMLElement>('[role="row"]');
    const wipRow = within(grid).getByText('WIP').closest<HTMLElement>('[role="row"]');

    if (!commitRow || !stashRow || !wipRow) throw new Error('Faltan filas comparables');

    const first = combination === 'stash-wip' ? stashRow : commitRow;
    const second = combination === 'commit-stash' ? stashRow : wipRow;
    const source = combination === 'stash-wip' ? `stash ${stash.message}` : shortSha(commit.sha);
    const target = combination === 'commit-stash' ? `stash ${stash.message}` : 'WIP';

    fireEvent.mouseDown(first, { button: 0 });
    fireEvent.mouseDown(second, { button: 0, ctrlKey: true });

    const panel = await screen.findByRole('region', { name: `Comparar ${source} con ${target}` });

    expect(panel).toBeVisible();

    if (combination !== 'commit-stash') {
      await user.click(await within(panel).findByText('inventario.md'));
      expect(useWorkingStore.getState().diff?.source).toEqual({
        kind: 'workingRange',
        from: combination === 'stash-wip' ? stash.sha : commit.sha,
      });
    }
  });

  it('compara inmediatamente dos stashes por sus OID reales', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const stashes = (await ports.git.readRefs('gitthul')).stashes;
    const [newest, oldest] = stashes;

    if (!newest || !oldest) throw new Error('El fixture necesita dos stashes');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const newestRow = within(grid).getByText(newest.message).closest<HTMLElement>('[role="row"]');
    const oldestRow = within(grid).getByText(oldest.message).closest<HTMLElement>('[role="row"]');

    if (!newestRow || !oldestRow) throw new Error('Faltan las filas de stash');

    fireEvent.mouseDown(newestRow, { button: 0 });
    fireEvent.mouseDown(oldestRow, { button: 0, ctrlKey: true });

    expect(
      await screen.findByRole('region', {
        name: `Comparar stash ${oldest.message} con stash ${newest.message}`,
      }),
    ).toBeVisible();
    expect(useWorkingStore.getState().compare).toMatchObject({
      kind: 'refs',
      source: { ref: oldest.sha },
      target: { ref: newest.sha },
    });
  });

  it('«Ver el historial» de un archivo abre `FileHistoryPanel` con commits de verdad', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const tracking = await screen.findByRole('region', { name: 'Cambios' });

    // `FileList` separa la carpeta del nombre en dos `span`; se ubica la fila
    // por el nombre y el clic derecho sube a la fila entera.
    const inventory = within(tracking).getByText('inventario.md');

    await user.click(inventory);
    expect(await screen.findByRole('region', { name: 'Diff de docs/inventario.md' })).toBeVisible();

    fireEvent.contextMenu(inventory);
    await user.click(await screen.findByRole('menuitem', { name: 'Ver el historial' }));

    const history = await screen.findByRole('region', {
      name: 'Historial de docs/inventario.md',
    });

    expect(screen.queryByRole('region', { name: 'Diff de docs/inventario.md' })).toBeNull();
    expect(within(history).getByText('Historial del archivo')).toBeVisible();
    expect(await within(history).findByText('docs/inventario.md')).toBeVisible();
    expect(within(history).getByText('Resumen de cambios')).toBeVisible();

    // El fixture reparte `docs/inventario.md` por la historia, así que la lista
    // trae commits de verdad y no un vacío.
    const versions = within(history).getAllByRole('listitem');

    expect(versions.length).toBeGreaterThan(1);

    // El historial permanece en el panel derecho mientras el diff ocupa el
    // centro, así que se puede saltar a otra versión sin cerrarlo.
    await user.click(within(versions[0] as HTMLElement).getByRole('button'));
    expect(await screen.findByRole('region', { name: 'Diff de docs/inventario.md' })).toBeVisible();
    expect(history).toBeVisible();

    await user.click(within(versions[1] as HTMLElement).getByRole('button'));
    expect(within(versions[1] as HTMLElement).getByRole('button')).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(versions[0] as HTMLElement).getByRole('button')).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('region', { name: 'Diff de docs/inventario.md' })).toBeVisible();
    expect(history).toBeVisible();

    await user.click(
      within(history).getByRole('button', { name: 'Cerrar el historial de docs/inventario.md' }),
    );

    expect(
      screen.queryByRole('region', { name: 'Historial de docs/inventario.md' }),
    ).not.toBeInTheDocument();
  });

  it.each([false, true])(
    'el botón del diff alterna el historial sin perder su comparación (amend: %s)',
    async (amend) => {
      const user = userEvent.setup();
      const ports = makePorts();
      const readHistory = vi.spyOn(ports.git, 'readFileHistory');
      renderApp(ports);
      await openRepo(user, GITTHUL_PATH);
      const tracking = await screen.findByRole('region', { name: 'Cambios' });
      await user.click(within(tracking).getByText('inventario.md'));
      const diff = await screen.findByRole('region', { name: 'Diff de docs/inventario.md' });
      if (amend) act(() => useWorkingStore.getState().setCommitDraft({ amend }));
      const button = within(diff).getByRole('button', {
        name: 'Ver el historial de docs/inventario.md',
      });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      await user.click(button);

      const history = await screen.findByRole('region', {
        name: 'Historial de docs/inventario.md',
      });
      expect(diff).toBeVisible();
      expect(useWorkingStore.getState().diff?.source).toEqual({ kind: 'worktree' });
      expect(readHistory).toHaveBeenCalledWith('gitthul', 'docs/inventario.md', expect.anything());
      const closeHistory = within(diff).getByRole('button', {
        name: 'Cerrar el historial de docs/inventario.md',
      });
      expect(closeHistory).toHaveAttribute('aria-pressed', 'true');

      await user.click(closeHistory);
      expect(history).not.toBeInTheDocument();
      expect(diff).toBeVisible();
      expect(useWorkingStore.getState().diff?.source).toEqual({ kind: 'worktree' });
      await user.click(button);
      const reopenedHistory = await screen.findByRole('region', {
        name: 'Historial de docs/inventario.md',
      });
      const versions = await within(reopenedHistory).findAllByRole('listitem');
      await user.click(within(versions[1] as HTMLElement).getByRole('button'));
      expect(useWorkingStore.getState().diff?.source.kind).toBe('commit');
      expect(within(versions[1] as HTMLElement).getByRole('button')).toHaveAttribute(
        'aria-current',
        'true',
      );
      await user.click(
        within(diff).getByRole('button', { name: 'Cerrar el diff de docs/inventario.md' }),
      );
      expect(reopenedHistory).toBeVisible();
    },
  );

  it('aplaza los avisos del watcher durante stash y refresca al terminar', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const createStash = ports.git.createStash.bind(ports.git);
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const create = vi.spyOn(ports.git, 'createStash').mockImplementation(async (...args) => {
      await gate;
      return createStash(...args);
    });
    const readStatus = vi.spyOn(ports.git, 'readStatus');
    let notify: ((change: { worktree: boolean; git: boolean }) => void) | undefined;
    vi.spyOn(ports.git, 'watchRepository').mockImplementation((_id, listener) => {
      notify = listener;
      return Promise.resolve(() => undefined);
    });
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('region', { name: 'Cambios' });
    await user.click(screen.getByRole('button', { name: 'Crear stash' }));
    expect(useWorkingStore.getState().pendingWrites).toBe(1);
    const before = readStatus.mock.calls.length;
    act(() => {
      notify?.({ worktree: true, git: false });
      notify?.({ worktree: true, git: true });
    });
    expect(readStatus).toHaveBeenCalledTimes(before);
    await act(async () => {
      finish();
      await gate;
    });
    await waitFor(() => expect(useWorkingStore.getState().pendingWrites).toBe(0));
    await waitFor(() => expect(useWorkingStore.getState().context?.hasWip).toBe(false));
    expect(create).toHaveBeenCalledOnce();
    expect(readStatus.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByRole('button', { name: 'Crear stash' })).toBeDisabled();
  });

  it('pasar un archivo al staging lo mueve de Cambios a Stage sin recargar la vista', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const tracking = await screen.findByRole('region', { name: 'Cambios' });

    fireEvent.contextMenu(within(tracking).getByText('roles.css'));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Agregar src/design/roles.css al staging' }),
    );

    const stage = await screen.findByRole('region', { name: 'Staging' });

    await waitFor(() => {
      expect(within(stage).getByText('roles.css')).toBeInTheDocument();
    });
  });

  it('clic en un archivo de Cambios abre el visor de diff con líneas de verdad', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const tracking = await screen.findByRole('region', { name: 'Cambios' });

    await user.click(within(tracking).getByText('roles.css'));

    const viewer = await screen.findByRole('region', { name: 'Diff de src/design/roles.css' });

    // El origen se nombra: lo de Cambios se compara contra el stage.
    expect(within(viewer).getByText('Árbol de trabajo')).toBeInTheDocument();

    expect(within(viewer).getByRole('radio', { name: 'Dos' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(viewer).getByRole('radio', { name: 'Archivo completo' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(viewer).getByRole('radio', { name: 'Una' }));
    const single = await screen.findAllByRole('textbox', {
      name: /^Diff de src\/design\/roles\.css, en una columna, desde la línea /,
    });

    expect(single.length).toBeGreaterThan(0);

    // Y la barra de acciones sigue viva: el visor cubre la tabla, no la barra
    // — decisión 2 del subplan.
    expect(
      screen.getByRole('toolbar', { name: 'Barra de acciones de GitWorking' }),
    ).toBeInTheDocument();

    // Dos columnas parte el hunk en la versión anterior y la nueva.
    await user.click(within(viewer).getByRole('radio', { name: 'Dos' }));

    expect(
      await screen.findAllByRole('textbox', {
        name: /^Versión anterior de src\/design\/roles\.css, desde la línea /,
      }),
    ).toHaveLength(single.length);
    expect(
      screen.getAllByRole('textbox', {
        name: /^Versión nueva de src\/design\/roles\.css, desde la línea /,
      }),
    ).toHaveLength(single.length);

    // Cada columna recorta sus propias líneas largas, pero ambas conservan la
    // misma posición horizontal para comparar carácter por carácter.
    const oldPane = screen.getAllByRole('region', {
      name: /^Desplazamiento horizontal de Versión anterior de src\/design\/roles\.css/,
    })[0];
    const newPane = screen.getAllByRole('region', {
      name: /^Desplazamiento horizontal de Versión nueva de src\/design\/roles\.css/,
    })[0];

    expect(oldPane).toBeDefined();
    expect(newPane).toBeDefined();
    const oldScroller = oldPane!.querySelector<HTMLElement>('.cm-scroller')!;
    const newScroller = newPane!.querySelector<HTMLElement>('.cm-scroller')!;
    Object.defineProperty(oldScroller, 'scrollLeft', { value: 96, writable: true });
    Object.defineProperty(newScroller, 'scrollLeft', { value: 0, writable: true });
    fireEvent.scroll(oldScroller);

    expect(newScroller.scrollLeft).toBe(96);
  });

  it('`Esc` cierra el visor sin salir del repositorio, y el botón también', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const tracking = await screen.findByRole('region', { name: 'Cambios' });

    await user.click(within(tracking).getByText('roles.css'));
    await screen.findByRole('region', { name: 'Diff de src/design/roles.css' });

    // Local al visor y fuera del registro central de gestos — decisión 8: la
    // pestaña sigue abierta y el grafo vuelve a estar delante.
    await user.keyboard('{Escape}');

    expect(
      screen.queryByRole('region', { name: 'Diff de src/design/roles.css' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Commits de gitthul' })).toBeInTheDocument();

    await user.click(within(tracking).getByText('roles.css'));
    await user.click(
      await screen.findByRole('button', { name: 'Cerrar el diff de src/design/roles.css' }),
    );

    expect(
      screen.queryByRole('region', { name: 'Diff de src/design/roles.css' }),
    ).not.toBeInTheDocument();
  });

  it('un hunk se pasa al staging desde el visor, y el archivo aparece en Stage', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const stageHunks = vi.spyOn(ports.git, 'stageHunks');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const tracking = await screen.findByRole('region', { name: 'Cambios' });

    await user.click(within(tracking).getByText('roles.css'));

    const viewer = await screen.findByRole('region', { name: 'Diff de src/design/roles.css' });

    await user.click(within(viewer).getByRole('radio', { name: 'Hunks' }));
    await user.click(within(viewer).getByRole('button', { name: 'Agregar el hunk 1 al staging' }));

    const request = stageHunks.mock.calls[0]?.[1];
    expect(stageHunks.mock.calls[0]?.[0]).toBe('gitthul');
    expect(request).toMatchObject({
      path: 'src/design/roles.css',
      hunkIds: ['hunk-1'],
      ignoreWhitespace: false,
    });
    expect(request?.precondition.before).not.toBeNull();
    expect(request?.precondition.after).not.toBeNull();

    const stage = await screen.findByRole('region', { name: 'Staging' });

    await waitFor(() => {
      expect(within(stage).getByText('roles.css')).toBeInTheDocument();
    });
  });

  it('los botones de línea reparten un archivo entre Cambios y Staging y permiten retirarlo', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const stageLines = vi.spyOn(ports.git, 'stageLines');
    const unstageLines = vi.spyOn(ports.git, 'unstageLines');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const changes = await screen.findByRole('region', { name: 'Cambios' });
    await user.click(within(changes).getByText('roles.css'));
    const viewer = await screen.findByRole('region', { name: 'Diff de src/design/roles.css' });
    const buttons = await within(viewer).findAllByRole('button', { name: /^Agregar la línea/ });
    await user.click(buttons[0]!);
    await waitFor(() => expect(stageLines).toHaveBeenCalledTimes(1));
    const request = stageLines.mock.calls[0]![1];
    expect(request.lines?.map((line) => line.side).sort()).toEqual(['new', 'old']);
    const staged = await screen.findByRole('region', { name: 'Staging' });
    await waitFor(() => expect(within(staged).getByText('roles.css')).toBeInTheDocument());
    expect(within(changes).getByText('roles.css')).toBeInTheDocument();
    const status = await ports.git.readStatus('gitthul');
    expect(status.staged.some((file) => file.path === request.path)).toBe(true);
    expect(status.unstaged.some((file) => file.path === request.path)).toBe(true);
    await waitFor(() => expect(useWorkingStore.getState().pendingWrites).toBe(0));
    await user.click(within(staged).getByText('roles.css'));
    const remove = await screen.findAllByRole('button', { name: /^Quitar la línea/ });
    expect(remove[0]).toHaveTextContent('−');
    await user.click(remove[0]!);
    await waitFor(() => expect(unstageLines).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(staged).queryByText('roles.css')).not.toBeInTheDocument());
    expect(within(changes).getByText('roles.css')).toBeInTheDocument();
  });

  it.each(['split', 'unified'] as const)(
    'el menú del diff prepara y retira varias líneas sin cerrar el visor (%s)',
    async (columns) => {
      const user = userEvent.setup();
      const ports = makePorts();
      const stageLines = vi.spyOn(ports.git, 'stageLines');
      const unstageLines = vi.spyOn(ports.git, 'unstageLines');
      useWorkingStore.getState().setDiffOptions({ columns, scope: 'file', content: 'diff' });
      renderApp(ports);
      await openRepo(user, GITTHUL_PATH);
      const changes = await screen.findByRole('region', { name: 'Cambios' });
      await user.click(within(changes).getByText('roles.css'));
      let viewer = await screen.findByRole('region', { name: 'Diff de src/design/roles.css' });

      const selectLines = async (direction: 'Agregar' | 'Quitar') => {
        const editors = await within(viewer).findAllByRole('textbox');
        const editor = editors[columns === 'split' ? 1 : 0]!;
        const controls = editor
          .closest('.cm-editor')!
          .querySelectorAll<HTMLElement>('.gitthul-line-choice');
        expect(controls.length).toBeGreaterThanOrEqual(2);
        const view = EditorView.findFromDOM(editor)!;
        const from = Number(controls[0]!.dataset.choiceLine);
        const to = Number(controls[1]!.dataset.choiceLine);
        act(() => {
          view.dispatch({
            selection: { anchor: view.state.doc.line(from).from, head: view.state.doc.line(to).to },
          });
        });
        fireEvent.contextMenu(editor);
        await user.click(
          await screen.findByRole('menuitem', {
            name:
              direction === 'Agregar'
                ? 'Agregar 2 líneas al staging'
                : 'Quitar 2 líneas del staging',
          }),
        );
      };

      await selectLines('Agregar');
      await waitFor(() => expect(stageLines).toHaveBeenCalledTimes(1));
      expect(stageLines.mock.calls[0]![1].lines!.length).toBeGreaterThanOrEqual(2);
      const staged = await screen.findByRole('region', { name: 'Staging' });
      await waitFor(() => expect(within(staged).getByText('roles.css')).toBeInTheDocument());
      expect(within(changes).getByText('roles.css')).toBeInTheDocument();
      expect(viewer).toBeInTheDocument();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      await waitFor(() => expect(useWorkingStore.getState().pendingWrites).toBe(0));
      const status = await ports.git.readStatus('gitthul');
      expect(status.staged.some((file) => file.path === 'src/design/roles.css')).toBe(true);
      expect(status.unstaged.some((file) => file.path === 'src/design/roles.css')).toBe(true);

      await user.click(within(staged).getByText('roles.css'));
      viewer = await screen.findByRole('region', { name: 'Diff de src/design/roles.css' });
      await within(viewer).findAllByRole('button', { name: /^Quitar la línea/ });
      await selectLines('Quitar');
      await waitFor(() => expect(unstageLines).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(within(staged).queryByText('roles.css')).not.toBeInTheDocument());
      expect(viewer).toBeInTheDocument();
      expect(within(changes).getByText('roles.css')).toBeInTheDocument();

      // Las acciones flotantes conservan el diff; un clic real fuera lo cierra.
      expect(useWorkingStore.getState().diff?.path).toBe('src/design/roles.css');
      await user.click(screen.getByRole('toolbar', { name: 'Barra de acciones de GitWorking' }));
      expect(viewer).not.toBeInTheDocument();
    },
  );

  it('el compositor entrega al commit el HEAD y el índice que estaban a la vista', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const readStatus = ports.git.readStatus.bind(ports.git);
    const precondition = { head: 'a'.repeat(40), indexTree: 'b'.repeat(40) };
    vi.spyOn(ports.git, 'readStatus').mockImplementation(async (id, query) => ({
      ...(await readStatus(id, query)),
      commitPrecondition: precondition,
    }));
    const commit = vi.spyOn(ports.git, 'commit');

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const summary = await screen.findByRole('textbox', { name: 'Resumen del commit' });
    const body = screen.getByRole('textbox', { name: 'Descripción del commit' });

    expect(summary).toHaveAttribute('placeholder', 'Resumen de commit');
    expect(body).toHaveAttribute('placeholder', 'Descripción');

    await user.type(summary, 'P2.4 real');
    await user.click(screen.getByRole('button', { name: 'Hacer commit en main' }));

    await waitFor(() => {
      expect(commit).toHaveBeenCalledWith(
        'gitthul',
        expect.objectContaining({ summary: 'P2.4 real', precondition }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Deshacer' })).toBeEnabled();
    });
  });

  it('el menú contextual de HEAD abre amend y los commits anteriores no lo ofrecen', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    const details = await ports.git.readCommit('gitthul', refs.head.sha);
    const commit = vi.spyOn(ports.git, 'commit');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const previousRow = within(grid)
      .getByText('F0.7: shell, barra inferior y máquina de pestañas')
      .closest<HTMLElement>('[role="row"]');
    if (!previousRow) throw new Error('Falta el commit anterior');
    fireEvent.contextMenu(previousRow);
    await screen.findByRole('menu');
    expect(
      screen.queryByRole('menuitem', { name: 'Modificar el último commit (amend)…' }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    const headRow = within(grid)
      .getByText(shortSha(refs.head.sha))
      .closest<HTMLElement>('[role="row"]');
    if (!headRow) throw new Error('Falta HEAD');
    fireEvent.contextMenu(headRow);
    await user.click(
      await screen.findByRole('menuitem', { name: 'Modificar el último commit (amend)…' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Resumen del commit' })).toHaveValue(
        details.commit.summary,
      ),
    );
    expect(
      screen.getByRole('checkbox', { name: 'Modificar el último commit (amend)' }),
    ).toBeChecked();
    expect(commit).not.toHaveBeenCalled();
  });

  it('carga amend sin el salto final del resumen y conserva la descripción al enviar', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    const details = await ports.git.readCommit('gitthul', refs.head.sha);
    const loadedSummary = 'Se renombran los ids de población y estado';
    const loadedBody = 'Descripción conservada.\nSegunda línea.';
    vi.spyOn(ports.git, 'readCommit').mockResolvedValue({
      ...details,
      commit: { ...details.commit, summary: `${loadedSummary}\n`, body: loadedBody },
    });
    const commit = vi.spyOn(ports.git, 'commit');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const summary = await screen.findByRole('textbox', { name: 'Resumen del commit' });
    await user.click(screen.getByRole('checkbox', { name: 'Modificar el último commit (amend)' }));

    await waitFor(() => expect(summary).toHaveValue(loadedSummary));
    expect(screen.getByRole('textbox', { name: 'Descripción del commit' })).toHaveValue(loadedBody);
    expect(screen.queryByText(/El resumen tiene más de una línea/)).not.toBeInTheDocument();
    expect(useWorkingStore.getState().commitDraft.summary).toBe(loadedSummary);

    await user.click(
      screen.getByRole('button', { name: 'Modificar el último commit de main (amend)' }),
    );
    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith(
        'gitthul',
        expect.objectContaining({ amend: true, summary: loadedSummary, body: loadedBody }),
      ),
    );
  });

  it('abre amend desde HEAD sin WIP, recorta el mensaje largo y envía el texto mostrado', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const status = await ports.git.readStatus('gitthul');
    await ports.git.stage(
      'gitthul',
      status.unstaged.map((file) => file.path),
    );
    await ports.git.commit('gitthul', { summary: 'Fixture limpio', body: '' });
    const before = await ports.git.readRefs('gitthul');
    expect((await ports.git.readStatus('gitthul')).clean).toBe(true);
    const originalRead = ports.git.readCommit.bind(ports.git);
    const longBody = 'Descripción extensa que se recorta automáticamente.\n'.repeat(120);
    const longSummary = 'Resumen existente que supera el límite de edición. '.repeat(3).trim();
    const loadedSummary = longSummary.slice(0, 72);
    const loadedBody = longBody.slice(0, 4500);
    vi.spyOn(ports.git, 'readCommit').mockImplementation(async (id, sha, query) => {
      const details = await originalRead(id, sha, query);
      return { ...details, commit: { ...details.commit, summary: longSummary, body: longBody } };
    });
    const commit = vi.spyOn(ports.git, 'commit');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByText(shortSha(before.head.sha)));
    await user.click(
      await screen.findByRole('button', { name: 'Modificar el último commit (amend)' }),
    );
    const body = await screen.findByRole('textbox', { name: 'Descripción del commit' });
    await waitFor(() => expect(body).toHaveValue(loadedBody));
    expect(body).toHaveAttribute('maxlength', '4500');
    await user.type(body, 'x');
    expect(body).toHaveValue(loadedBody);
    const summary = screen.getByRole('textbox', { name: 'Resumen del commit' });
    expect(summary).toHaveValue(loadedSummary);
    expect(summary).toHaveAttribute('maxlength', '72');
    await user.type(summary, 'x');
    expect(summary).toHaveValue(loadedSummary);
    expect(useWorkingStore.getState().commitDraft).toMatchObject({
      summary: loadedSummary,
      body: loadedBody,
    });
    await user.click(
      screen.getByRole('button', { name: 'Modificar el último commit de main (amend)' }),
    );
    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith(
        'gitthul',
        expect.objectContaining({
          amend: true,
          summary: loadedSummary.trim(),
          body: loadedBody.trim(),
        }),
      ),
    );
    expect((await ports.git.readStatus('gitthul')).clean).toBe(true);
  });

  it('amend puede conservar Stage y cancelar restaura el borrador', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const status = await ports.git.readStatus('gitthul');
    const commit = vi.spyOn(ports.git, 'commit');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const summary = await screen.findByRole('textbox', { name: 'Resumen del commit' });
    await user.type(summary, 'Borrador normal');
    const amend = screen.getByRole('checkbox', { name: 'Modificar el último commit (amend)' });
    await user.click(amend);
    await waitFor(() => expect(summary).toBeEnabled());
    await user.click(amend);
    expect(summary).toHaveValue('Borrador normal');
    await user.click(amend);
    await waitFor(() => expect(summary).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: 'Cambiar solo el mensaje' }));
    await user.click(
      screen.getByRole('button', { name: 'Modificar el último commit de main (amend)' }),
    );
    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith(
        'gitthul',
        expect.objectContaining({ amend: true, amendMessageOnly: true }),
      ),
    );
    expect((await ports.git.readStatus('gitthul')).staged).toEqual(status.staged);
  });

  it('la búsqueda abre amend desde otro commit y no escribe hasta revisar el mensaje', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    const details = await ports.git.readCommit('gitthul', refs.head.sha);
    const commit = vi.spyOn(ports.git, 'commit');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('grid');
    act(() => useWorkingStore.getState().setSelectedCommits(new Set([details.commit.parents[0]!])));
    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}');
    expect(useWorkingStore.getState().commitDraft.amend).toBe(false);
    await user.keyboard('{Control>}p{/Control}');
    const search = within(screen.getByRole('dialog', { name: 'Búsqueda global' }));
    await user.type(search.getByRole('combobox', { name: /Buscar/ }), 'amend');
    await user.click(await search.findByRole('option', { name: /^Modificar el último commit/ }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Resumen del commit' })).toHaveValue(
        details.commit.summary,
      ),
    );
    expect(commit).not.toHaveBeenCalled();
  });

  it('no envía amend mientras carga y cancelar descarta la lectura tardía', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const refs = await ports.git.readRefs('gitthul');
    const details = await ports.git.readCommit('gitthul', refs.head.sha);
    let finish: ((value: typeof details) => void) | undefined;
    vi.spyOn(ports.git, 'readCommit').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const commit = vi.spyOn(ports.git, 'commit');
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const summary = await screen.findByRole('textbox', { name: 'Resumen del commit' });
    await user.type(summary, 'Borrador conservado');
    const amend = screen.getByRole('checkbox', { name: 'Modificar el último commit (amend)' });
    await user.click(amend);
    expect(summary).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Modificar el último commit de main (amend)' }),
    ).toBeDisabled();
    await user.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}');
    expect(commit).not.toHaveBeenCalled();
    await user.click(amend);
    await act(async () => {
      finish?.(details);
      await Promise.resolve();
    });
    expect(summary).toHaveValue('Borrador conservado');
    expect(amend).not.toBeChecked();
  });

  it('si HEAD cambia durante amend exige cancelar y revisar la nueva punta', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const readRefs = ports.git.readRefs.bind(ports.git);
    let changed = false;
    vi.spyOn(ports.git, 'readRefs').mockImplementation(async (id, query) => {
      const refs = await readRefs(id, query);
      return changed ? { ...refs, head: { ...refs.head, sha: 'f'.repeat(40) } } : refs;
    });
    let notify: ((change: { worktree: boolean; git: boolean }) => void) | undefined;
    vi.spyOn(ports.git, 'watchRepository').mockImplementation((_id, listener) => {
      notify = listener;
      return Promise.resolve(() => undefined);
    });
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const amend = await screen.findByRole('checkbox', {
      name: 'Modificar el último commit (amend)',
    });
    await user.click(amend);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Resumen del commit' })).toBeEnabled(),
    );
    changed = true;
    act(() => notify?.({ worktree: true, git: true }));
    await screen.findByText(
      'HEAD cambió. Cancela amend y vuelve a abrirlo para revisar el último commit.',
    );
    expect(
      screen.getByRole('button', { name: 'Modificar el último commit de main (amend)' }),
    ).toBeDisabled();
  });

  it('impide saltos en el resumen y limita escritura y pegado a 72 y 4500 caracteres', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);
    const summary = await screen.findByRole('textbox', { name: 'Resumen del commit' });
    const body = screen.getByRole('textbox', { name: 'Descripción del commit' });

    await user.type(summary, 'Resumen{Enter}');

    expect(summary).toHaveValue('Resumen');
    expect(body).toHaveFocus();

    await user.clear(summary);
    await user.clear(body);
    await user.click(summary);
    await user.paste('Resumen pegado\nDetalle pegado');

    expect(summary).toHaveValue('Resumen pegado Detalle pegado');
    expect(body).toHaveValue('');
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute('maxlength', '72');
    expect(body).toHaveAttribute('maxlength', '4500');

    await user.clear(summary);
    await user.click(summary);
    await user.paste('s'.repeat(100));
    expect(summary).toHaveValue('s'.repeat(72));
    await user.type(summary, 'extra');
    expect(summary).toHaveValue('s'.repeat(72));

    await user.click(body);
    const pastedBody = 'Descripción larga con saltos de línea.\n'.repeat(150);
    await user.paste(pastedBody);
    expect(body).toHaveValue(pastedBody.slice(0, 4500));
    await user.type(body, 'extra');
    expect(body).toHaveValue(pastedBody.slice(0, 4500));

    fireEvent.change(summary, { target: { value: 'r'.repeat(73) } });
    expect(summary).toHaveValue('r'.repeat(72));
    expect(useWorkingStore.getState().commitDraft.summary).toBe('r'.repeat(72));
    fireEvent.change(body, { target: { value: 'x'.repeat(4501) } });

    expect(body).toHaveValue('x'.repeat(4500));
    expect(useWorkingStore.getState().commitDraft.body).toBe('x'.repeat(4500));
    expect(summary.className).toMatch(/atLimit/);
    expect(body.className).toMatch(/atLimit/);
  });

  it('da a Cambios y Stage controles de árbol independientes y oculta sus conteos', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);
    const tracking = await screen.findByRole('region', { name: 'Cambios' });
    const stage = screen.getByRole('region', { name: 'Staging' });

    expect(within(tracking).queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    expect(within(tracking).queryByText(/^−\d+$/)).not.toBeInTheDocument();
    expect(within(stage).queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    expect(within(stage).queryByText(/^−\d+$/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Árbol' }));

    const trackingCollapse = within(tracking).getByRole('button', {
      name: 'Colapsar todo',
    });
    expect(within(stage).getByRole('button', { name: 'Colapsar todo' })).toBeVisible();

    await user.click(trackingCollapse);

    expect(within(tracking).getByRole('button', { name: 'Expandir todo' })).toBeVisible();
    expect(within(stage).getByRole('button', { name: 'Colapsar todo' })).toBeVisible();
  });

  it('un aviso externo relee status y la desuscripción sigue al ciclo de la pestaña', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const readStatus = vi.spyOn(ports.git, 'readStatus');
    const stop = vi.fn();
    let notify: ((change: { worktree: boolean; git: boolean }) => void) | undefined;
    vi.spyOn(ports.git, 'watchRepository').mockImplementation((_id, listener) => {
      notify = listener;
      return Promise.resolve(stop);
    });
    const view = renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('region', { name: 'Cambios' });
    const before = readStatus.mock.calls.length;

    act(() => {
      notify?.({ worktree: true, git: false });
    });
    await waitFor(() => expect(readStatus.mock.calls.length).toBeGreaterThan(before));

    view.unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('conserva la vista mientras el watcher actualiza los metadatos Git', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const readRepository = ports.git.readRepository.bind(ports.git);
    let holdRefresh = false;
    let releaseRefresh: () => void = () => undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const read = vi.spyOn(ports.git, 'readRepository').mockImplementation(async (id, query) => {
      if (holdRefresh) await refreshGate;

      return readRepository(id, query);
    });
    let notify: ((change: { worktree: boolean; git: boolean }) => void) | undefined;
    vi.spyOn(ports.git, 'watchRepository').mockImplementation((_id, listener) => {
      notify = listener;
      return Promise.resolve(() => undefined);
    });

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const before = read.mock.calls.length;

    holdRefresh = true;
    act(() => {
      notify?.({ worktree: true, git: true });
    });

    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before));
    expect(grid).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Commits de gitthul' })).toBe(grid);

    await act(async () => {
      releaseRefresh();
      await refreshGate;
    });
  });

  it.each([false, true])(
    'un stash completo descarta una lectura anterior del watcher (metadatos: %s)',
    async (metadata) => {
      const user = userEvent.setup();
      const ports = makePorts();
      const readStatus = ports.git.readStatus.bind(ports.git);
      const initial = await readStatus('gitthul');
      const untracked = initial.unstaged.filter((file) => file.change === 'untracked');
      expect(untracked.length).toBeGreaterThan(0);
      const stale: WorkingStatus = { ...initial, staged: [], unstaged: untracked, conflicted: [] };
      let delayNext = false;
      let finish: ((value: WorkingStatus) => void) | undefined;
      vi.spyOn(ports.git, 'readStatus').mockImplementation((id, query) => {
        if (!delayNext) return readStatus(id, query);
        delayNext = false;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      let notify: ((change: { worktree: boolean; git: boolean }) => void) | undefined;
      vi.spyOn(ports.git, 'watchRepository').mockImplementation((_id, listener) => {
        notify = listener;
        return Promise.resolve(() => undefined);
      });
      const create = vi.spyOn(ports.git, 'createStash');
      renderApp(ports);
      await openRepo(user, GITTHUL_PATH);
      await screen.findByRole('region', { name: 'Cambios' });
      delayNext = true;
      act(() => notify?.({ worktree: true, git: metadata }));
      await waitFor(() => expect(finish).toBeDefined());

      await user.click(screen.getByRole('button', { name: 'Crear stash' }));
      await waitFor(() => expect(useWorkingStore.getState().pendingWrites).toBe(0));
      expect(create).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledWith(
        'gitthul',
        expect.any(String),
        expect.objectContaining({ includeUntracked: true }),
      );
      expect((await readStatus('gitthul')).clean).toBe(true);
      await act(async () => {
        finish?.(stale);
        await Promise.resolve();
      });
      expect(useWorkingStore.getState().context?.hasWip).toBe(false);
      expect(screen.getByRole('button', { name: 'Crear stash' })).toBeDisabled();
    },
  );

  it('un Pop conflictivo abre Resolver sin esperar al watcher y solo se ejecuta una vez', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const readRepository = vi.spyOn(ports.git, 'readRepository');
    const readStatus = ports.git.readStatus.bind(ports.git);
    const initial = await readStatus('gitthul');
    const source = initial.unstaged[0];

    if (!source) throw new Error('El fixture debe tener un cambio sin preparar');

    const conflict: WorkingStatus = {
      ...initial,
      unstaged: initial.unstaged.slice(1),
      conflicted: [{ ...source, change: 'conflicted', conflict: 'bothModified' }],
      clean: false,
      recoveryOperation: 'pop',
    };
    let popFailed = false;
    let cancelled = false;
    vi.spyOn(ports.git, 'readStatus').mockImplementation((id, query) =>
      popFailed && !cancelled ? Promise.resolve(conflict) : readStatus(id, query),
    );
    vi.spyOn(ports.git, 'autoResolve').mockResolvedValue({ resolved: [], status: conflict });
    const applyStash = vi.spyOn(ports.git, 'applyStash').mockImplementation(() => {
      popFailed = true;
      return Promise.reject(
        new GitOperationError('stash.conflict', {
          stash: 'stash@{0}',
          branch: 'main',
          count: 1,
        }),
      );
    });
    const readRepositoryReal = ports.git.readRepository.bind(ports.git);
    const abortOperation = vi.spyOn(ports.git, 'abortOperation').mockImplementation(async (id) => {
      cancelled = true;
      return readRepositoryReal(id);
    });
    let notify: ((change: { worktree: boolean; git: boolean }) => void) | undefined;
    vi.spyOn(ports.git, 'watchRepository').mockImplementation((_id, listener) => {
      notify = listener;
      return Promise.resolve(() => undefined);
    });

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    act(() => useWorkingStore.setState({ selectedCommits: new Set(['stash:0']) }));
    useResolveStore.getState().setAutoResolveDone(true);
    const bar = await screen.findByRole('toolbar', { name: 'Barra de acciones de GitWorking' });

    await user.click(
      within(bar).getByRole('button', { name: 'Aplicar y eliminar el stash seleccionado (pop)' }),
    );
    await waitFor(() => expect(applyStash).toHaveBeenCalledOnce());

    expect(
      await screen.findByText('Resolviendo los conflictos de stash pop en main'),
    ).toBeInTheDocument();
    expect(screen.getByText('El intento de stash pop ha generado conflictos')).toBeVisible();
    expect(
      screen.getByText(
        'El panel derecho reúne lo que debes resolver antes de volver al historial.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'En conflicto' })).toBeInTheDocument();
    expect(
      await screen.findByText(
        `Aplicar stash ${useWorkingStore.getState().context?.stashes?.[0]?.message} sobre main dejó 1 archivos en conflicto`,
      ),
    ).toBeVisible();
    const cancel = screen.getByRole('button', {
      name: 'Abortar stash pop',
    });
    const warning = screen
      .getByText('El intento de stash pop ha generado conflictos')
      .closest('[role="status"]');

    expect(cancel).toBeEnabled();
    expect(within(warning as HTMLElement).getByRole('button', { name: 'Abortar stash pop' })).toBe(
      cancel,
    );
    expect(
      within(warning as HTMLElement).getByRole('button', { name: 'Marcar todo como resuelto' }),
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Terminar stash pop' })).toBeDisabled();

    const blockedGraph = screen
      .getByRole('grid', { name: 'Commits de gitthul' })
      .closest('[inert]');
    const blockedRefs = screen
      .getByRole('region', { name: 'Referencias de gitthul' })
      .closest('[inert]');

    expect(blockedGraph?.className).toMatch(/blockedSurface/);
    expect(blockedRefs?.className).toMatch(/blockedSurface/);

    const readsBeforeSecondNotice = readRepository.mock.calls.length;
    act(() => {
      notify?.({ worktree: true, git: true });
    });
    await waitFor(() =>
      expect(readRepository.mock.calls.length).toBeGreaterThan(readsBeforeSecondNotice),
    );
    expect(applyStash).toHaveBeenCalledOnce();

    await user.click(cancel);
    await waitFor(() => expect(abortOperation).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByText('Resolviendo los conflictos de stash pop en main'),
      ).not.toBeInTheDocument(),
    );
  });

  it('en «Archivo completo» el visor no enseña cabeceras de hunk', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const tracking = await screen.findByRole('region', { name: 'Cambios' });

    await user.click(within(tracking).getByText('roles.css'));

    const viewer = await screen.findByRole('region', { name: 'Diff de src/design/roles.css' });

    await user.click(within(viewer).getByRole('radio', { name: 'Hunks' }));
    expect(
      within(viewer).getByRole('button', { name: 'Agregar el hunk 1 al staging' }),
    ).toBeInTheDocument();

    await user.click(within(viewer).getByRole('radio', { name: 'Archivo completo' }));

    await waitFor(() => {
      expect(
        within(viewer).queryByRole('button', { name: /^Agregar el hunk .* al staging$/ }),
      ).not.toBeInTheDocument();
    });
    expect(within(viewer).queryByText(/^Líneas \d+ a \d+$/)).not.toBeInTheDocument();

    // Volver a «Hunks» la trae de vuelta: no es una vista que perdió la cabecera para siempre.
    await user.click(within(viewer).getByRole('radio', { name: 'Hunks' }));

    expect(
      await within(viewer).findByRole('button', { name: 'Agregar el hunk 1 al staging' }),
    ).toBeInTheDocument();
  });

  /*
   * Un editor por tramo era lo que impedía marcar de un hunk al siguiente: cada
   * uno tiene su propia selección y ninguno se entera de los demás, así que el
   * arrastre se paraba en el borde y lo marcado antes se quedaba encendido.
   */
  it('en «Archivo completo» el archivo entero es un solo visor, no uno por tramo', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const tracking = await screen.findByRole('region', { name: 'Cambios' });

    await user.click(within(tracking).getByText('roles.css'));

    const viewer = await screen.findByRole('region', { name: 'Diff de src/design/roles.css' });
    const unified = /^Diff de src\/design\/roles\.css, en una columna, desde la línea /;

    // El reparto de columnas vive en el store y sobrevive de una prueba a otra;
    // esta cuenta visores, así que fija el modo en vez de heredarlo.
    const oneColumn = within(viewer).getByRole('radio', { name: 'Una' });
    if (oneColumn.getAttribute('aria-checked') !== 'true') await user.click(oneColumn);

    await user.click(within(viewer).getByRole('radio', { name: 'Hunks' }));
    // En «Hunks» hay uno por hunk, que es justo lo que ese modo quiere.
    expect((await within(viewer).findAllByRole('textbox', { name: unified })).length).toBe(3);

    await user.click(within(viewer).getByRole('radio', { name: 'Archivo completo' }));

    await waitFor(() => {
      expect(within(viewer).getAllByRole('textbox', { name: unified })).toHaveLength(1);
    });
  });

  it('el diff de un commit es de solo lectura y no se recarga por avisos del working tree', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const readDiff = vi.spyOn(ports.git, 'readDiff');
    const readStatus = vi.spyOn(ports.git, 'readStatus');
    let notify: ((change: { worktree: boolean; git: boolean }) => void) | undefined;
    vi.spyOn(ports.git, 'watchRepository').mockImplementation((_id, listener) => {
      notify = listener;
      return Promise.resolve(() => undefined);
    });

    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    // Skip WIP + stash rows that now appear at the top to reach a real commit.
    const row = within(grid).getAllByRole('row').slice(4)[0];

    if (!row) throw new Error('La tabla no montó ninguna fila de commit');

    fireEvent.mouseDown(row, { button: 0 });

    const details = await screen.findByRole('region', { name: /^Detalles del commit / });
    const files = within(details).getAllByRole('option');
    const first =
      files.find((file) => /\.(?:css|ts|tsx)\b/.test(file.textContent ?? '')) ?? files[0];

    if (!first) throw new Error('El commit no trae archivos');

    await user.click(first);

    const viewer = await screen.findByRole('region', { name: /^Diff de / });

    // Un commit ya escrito no se prepara: los botones de stage no existen.
    expect(within(viewer).queryByRole('button', { name: /al staging$/ })).not.toBeInTheDocument();
    // Aunque tenga muchos hunks, un histórico monta uno por columna y no un
    // CodeMirror completo por cada tramo.
    expect(within(viewer).getAllByRole('textbox').length).toBeLessThanOrEqual(2);

    const diffReads = readDiff.mock.calls.length;
    const statusReads = readStatus.mock.calls.length;
    act(() => {
      notify?.({ worktree: true, git: false });
    });
    await waitFor(() => expect(readStatus.mock.calls.length).toBeGreaterThan(statusReads));
    expect(readDiff).toHaveBeenCalledTimes(diffReads);
  });

  it('Ver todos carga el árbol del commit solo en modo árbol y conserva sus cambios', async () => {
    const ports = makePorts();
    const readTree = vi
      .spyOn(ports.git, 'readTree')
      .mockResolvedValue([{ path: 'sin-cambios.txt', kind: 'file' }]);
    const readCommit = vi.spyOn(ports.git, 'readCommit');
    const user = userEvent.setup();

    renderApp(ports);
    await openRepo(userEvent.setup(), GITTHUL_PATH);

    const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
    const row = within(grid).getAllByRole('row').slice(4)[0];

    if (!row) throw new Error('La tabla no montó ninguna fila de commit');

    fireEvent.mouseDown(row, { button: 0 });

    const details = await screen.findByRole('region', { name: /^Detalles del commit / });

    expect(
      within(details).queryByRole('checkbox', { name: 'Todos los archivos' }),
    ).not.toBeInTheDocument();
    expect(readTree).not.toHaveBeenCalled();

    await user.click(within(details).getByRole('radio', { name: 'Árbol' }));
    const showAll = within(details).getByRole('checkbox', { name: 'Todos los archivos' });
    expect(showAll).not.toBeChecked();
    expect(readTree).not.toHaveBeenCalled();

    const changedFiles = readCommit.mock.results.at(-1);
    if (!changedFiles) throw new Error('No se leyó el commit');
    const { files } = await (changedFiles.value as ReturnType<AppPorts['git']['readCommit']>);
    await user.click(showAll);
    expect(await within(details).findByText('sin-cambios.txt')).toBeInTheDocument();
    expect(showAll).toBeChecked();
    expect(readTree.mock.calls[0]?.[0]).toBe(readCommit.mock.calls.at(-1)?.[0]);
    expect(readTree.mock.calls[0]?.[1]).toBe(readCommit.mock.calls.at(-1)?.[1]);
    expect(readTree.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    // El árbol no contiene estos cambios: tampoco se pierden los borrados.
    for (const file of files) {
      expect(within(details).getByText(file.path.split('/').at(-1) ?? '')).toBeInTheDocument();
    }
    await user.click(showAll);
    await waitFor(() =>
      expect(within(details).queryByText('sin-cambios.txt')).not.toBeInTheDocument(),
    );
    expect(readTree).toHaveBeenCalledTimes(1);

    await user.click(within(details).getByRole('radio', { name: 'Lista' }));
    expect(within(details).queryByRole('checkbox', { name: 'Todos los archivos' })).toBeNull();
  });

  it.each([false, true])(
    'reabrir el historial desde Ver todos conserva el filtro y los toggles de carpetas (todo expandido: %s)',
    async (treeExpanded) => {
      const ports = makePorts();
      const readCommit = ports.git.readCommit;
      vi.spyOn(ports.git, 'readCommit').mockImplementation(async (...args) => {
        const details = await readCommit(...args);
        return {
          ...details,
          files: details.files.filter((file) => file.path !== 'docs/inventario.md'),
        };
      });
      const pendingTrees: Array<(tree: Awaited<ReturnType<AppPorts['git']['readTree']>>) => void> =
        [];
      const readTree = vi.spyOn(ports.git, 'readTree').mockImplementation(
        () =>
          new Promise((resolve) => {
            pendingTrees.push(resolve);
          }),
      );
      const readHistory = vi.spyOn(ports.git, 'readFileHistory');
      const user = userEvent.setup();
      renderApp(ports);
      await openRepo(user, GITTHUL_PATH);
      const grid = await screen.findByRole('grid', { name: 'Commits de gitthul' });
      const row = within(grid).getAllByRole('row').slice(4)[0];
      if (!row) throw new Error('La tabla no montó ninguna fila de commit');
      await act(async () => {
        useWorkingStore.getState().setFileTreeExpanded(treeExpanded);
        fireEvent.mouseDown(row, { button: 0 });
        await Promise.resolve();
      });

      for (let cycle = 0; cycle < 3; cycle += 1) {
        const details = await screen.findByRole('region', { name: /^Detalles del commit / });
        if (cycle === 0) await user.click(within(details).getByRole('radio', { name: 'Árbol' }));
        const filter = within(details).getByRole('searchbox', {
          name: 'Filtrar los archivos por ruta',
        });
        expect(filter).toHaveValue(cycle === 0 ? '' : 'inventario.md');
        const showAll = within(details).getByRole('checkbox', { name: 'Todos los archivos' });
        expect(showAll).not.toBeChecked();
        await user.click(showAll);
        if (cycle === 0) await user.type(filter, 'inventario.md');
        expect(within(details).queryByText('inventario.md')).not.toBeInTheDocument();
        expect(readTree).toHaveBeenCalledTimes(cycle + 1);
        const resolveTree = pendingTrees.shift();
        if (!resolveTree) throw new Error('No se inició la lectura del árbol');
        await act(async () => {
          resolveTree([{ path: 'docs/inventario.md', kind: 'file' }]);
          await Promise.resolve();
        });

        const folder = await within(details).findByRole('treeitem', { name: /^docs/ });
        expect(folder).toHaveAttribute('aria-expanded', String(treeExpanded));
        const arrow = folder.firstElementChild;
        if (!arrow) throw new Error('La carpeta no tiene flecha');
        // Primero abre el historial. Los toggles se prueban al volver, cuando
        // el panel se monta otra vez con el filtro que ya estaba escrito.
        if (cycle === 0) {
          if (!treeExpanded) await user.click(arrow);
        } else {
          if (treeExpanded) await user.click(within(folder).getByText('docs'));
          expect(folder).toHaveAttribute('aria-expanded', 'false');
          expect(within(details).queryByText('inventario.md')).not.toBeInTheDocument();
          await user.click(arrow);
          expect(folder).toHaveAttribute('aria-expanded', 'true');
          expect(within(details).getByText('inventario.md')).toBeVisible();
          await user.click(within(folder).getByText('docs'));
          expect(folder).toHaveAttribute('aria-expanded', 'false');
          await user.click(within(folder).getByText('docs'));
        }
        expect(folder).toHaveAttribute('aria-expanded', 'true');
        expect(within(details).getByText('inventario.md')).toBeVisible();
        expect(useWorkingStore.getState().fileTreeExpanded).toBe(treeExpanded);

        fireEvent.contextMenu(within(details).getByText('inventario.md'));
        await user.click(await screen.findByRole('menuitem', { name: 'Ver el historial' }));
        const history = await screen.findByRole('region', {
          name: 'Historial de docs/inventario.md',
        });
        await waitFor(() => expect(readHistory).toHaveBeenCalledTimes(cycle + 1));
        expect((await within(history).findAllByRole('listitem')).length).toBeGreaterThan(0);
        await user.click(
          within(history).getByRole('button', {
            name: 'Cerrar el historial de docs/inventario.md',
          }),
        );
        expect(history).not.toBeInTheDocument();
        expect(useWorkingStore.getState().fileFilter).toBe('inventario.md');
      }
    },
  );

  it('las listas de cambios y staging no ofrecen Ver todos en modo árbol', async () => {
    const ports = makePorts();
    const readTree = vi.spyOn(ports.git, 'readTree');
    const user = userEvent.setup();
    renderApp(ports);
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('region', { name: 'Cambios' });
    await user.click(screen.getByRole('radio', { name: 'Árbol' }));
    expect(screen.getByRole('tree', { name: 'Cambios' })).toBeInTheDocument();
    expect(screen.getByRole('tree', { name: 'Staging' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Todos los archivos' })).toBeNull();
    expect(readTree).not.toHaveBeenCalled();
  });

  it('el botón pliega y despliega referencias y Alt+B ya no cambia el panel', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    await screen.findByRole('region', { name: 'Referencias de gitthul' });

    await user.keyboard('{Alt>}b{/Alt}');
    expect(screen.getByRole('region', { name: 'Referencias de gitthul' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Plegar el panel de referencias' }));

    expect(
      await screen.findByRole('toolbar', { name: 'Referencias de gitthul' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Referencias de gitthul' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Desplegar el panel de referencias' }));

    expect(
      await screen.findByRole('region', { name: 'Referencias de gitthul' }),
    ).toBeInTheDocument();
  });

  it('la búsqueda pliega y despliega el panel de detalles', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);
    await screen.findByRole('region', { name: 'Referencias de gitthul' });

    await user.keyboard('{Control>}p{/Control}');
    await user.type(screen.getByRole('combobox', { name: /Buscar/ }), 'panel de detalles');

    expect(
      await screen.findByRole(
        'option',
        { name: /^Plegar el panel de detalles/ },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /^Plegar el panel de detalles/ }));

    await user.keyboard('{Control>}p{/Control}');
    await user.type(screen.getByRole('combobox', { name: /Buscar/ }), 'panel de detalles');

    expect(
      await screen.findByRole(
        'option',
        { name: /^Desplegar el panel de detalles/ },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });
  /*
   * Los trece gestos sobre el objeto señalado — 4 de agosto de 2026.
   *
   * Lo que estas dos pruebas fijan no es la acción, que ya funcionaba por menú,
   * sino que el registro la alcance: lo señalado en un panel llega al store, y
   * de ahí al rótulo y al atajo.
   */
  it('borra la rama señalada y la recorre por Deshacer y Rehacer', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });

    fireEvent.mouseDown(within(locals).getByText('dev'), { button: 0 });

    await user.keyboard('{Control>}{Delete}{/Control}');
    expect(screen.queryByRole('dialog', { name: 'Eliminar dev' })).not.toBeInTheDocument();
    fireEvent.contextMenu(within(locals).getByText('dev'));
    await user.click(await screen.findByRole('menuitem', { name: 'Eliminar dev' }));

    await user.click(await screen.findByRole('button', { name: 'Eliminar dev' }));
    await waitFor(() => {
      expect(within(locals).queryByText('dev')).not.toBeInTheDocument();
    });

    const undo = screen.getByRole('button', { name: 'Deshacer' });
    await waitFor(() => {
      expect(undo).toBeEnabled();
    });
    await user.click(undo);
    expect(await within(locals).findByText('dev')).toBeInTheDocument();

    const redo = screen.getByRole('button', { name: 'Rehacer' });
    await waitFor(() => {
      expect(redo).toBeEnabled();
    });
    await user.click(redo);
    await waitFor(() => {
      expect(within(locals).queryByText('dev')).not.toBeInTheDocument();
    });
  });

  it('marcar en Cambios cambia el rótulo del gesto de pasar al staging', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const tracking = await screen.findByRole('region', { name: 'Cambios' });
    // Elegir una categoría remonta la paleta: consultar siempre su diálogo actual.
    const search = () => within(screen.getByRole('dialog', { name: 'Búsqueda global' }));

    // Sin nada marcado el gesto está deshabilitado, y `GlobalSearch` no lista
    // lo deshabilitado: lo que se ve es «Agregar todo al staging», que sí puede.
    await user.keyboard('{Control>}p{/Control}');
    await user.type(search().getByRole('combobox', { name: 'Buscar en GitThul' }), 'al staging');
    await waitFor(
      () => expect(search().getByRole('button', { name: 'Ver Acciones' })).toBeEnabled(),
      { timeout: 5000 },
    );
    await user.click(search().getByRole('button', { name: 'Ver Acciones' }));

    expect(search().queryByRole('option', { name: /^Agregar 1 archivos al staging/ })).toBeNull();
    expect(
      await search().findByRole('option', { name: /^Agregar todo al staging/ }),
    ).toBeInTheDocument();

    await user.keyboard('{Escape}');

    fireEvent.mouseDown(within(tracking).getByText('inventario.md'), { button: 0 });

    await user.keyboard('{Control>}p{/Control}');
    await user.type(search().getByRole('combobox', { name: 'Buscar en GitThul' }), 'al staging');
    await waitFor(
      () => expect(search().getByRole('button', { name: 'Ver Acciones' })).toBeEnabled(),
      { timeout: 5000 },
    );
    await user.click(search().getByRole('button', { name: 'Ver Acciones' }));

    expect(
      await search().findByRole('option', { name: /^Agregar 1 archivos al staging/ }),
    ).toBeInTheDocument();
  });
  /*
   * Resolver — F3.1. Vive en estas pruebas y no en las suyas porque es un
   * estado de GitWorking, no una vista aparte: quien decide si se enseña es
   * `WorkingView`, y lo que hay que comprobar es justo esa decisión.
   */
  it('un repositorio con conflictos abre en Resolver y deja la tabla inhabilitada', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);

    expect(await screen.findByRole('region', { name: 'En conflicto' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Resueltos' })).toBeInTheDocument();
    // Cambios y Stage dejan su sitio mientras dure la operación.
    expect(screen.queryByRole('region', { name: 'Cambios' })).not.toBeInTheDocument();

    // El grafo no responde: `inert` lo saca del ratón, del teclado y del árbol
    // de accesibilidad de una vez.
    const grid = await screen.findByRole('grid', { name: 'Commits de bitacora' });
    const refs = screen.getByRole('region', { name: 'Referencias de bitacora' });
    const blockedGraph = grid.closest('[inert]');
    const blockedRefs = refs.closest('[inert]');
    const operationNotice = screen
      .getByText('El intento de merge ha generado conflictos')
      .closest('[role="status"]');

    expect(blockedGraph).not.toBeNull();
    expect(blockedRefs).not.toBeNull();
    expect(blockedGraph?.className).toMatch(/blockedSurface/);
    expect(blockedRefs?.className).toMatch(/blockedSurface/);
    expect(
      within(operationNotice as HTMLElement).getByRole('button', { name: 'Abortar merge' }),
    ).toBeEnabled();
    expect(
      within(operationNotice as HTMLElement).getByRole('button', {
        name: 'Marcar todo como resuelto',
      }),
    ).toBeEnabled();
    expect(screen.getByText('Se detectaron 8 archivos en conflicto')).toBeVisible();
  });

  it('la autoresolución cierra lo inequívoco sola y lo marca en Resueltos', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);

    const resolved = await screen.findByRole('region', { name: 'Resueltos' });

    await waitFor(() => {
      expect(within(resolved).getByText('.gitignore')).toBeInTheDocument();
    });

    expect(
      within(resolved).getByRole('button', { name: 'Devolver este archivo a conflictos' }),
    ).toBeInTheDocument();

    // Lo que pide una decisión se queda en la otra lista, con su frase.
    const conflicted = screen.getByRole('region', { name: 'En conflicto' });

    expect(within(conflicted).getByText('plan.md')).toBeInTheDocument();
    expect(within(conflicted).queryByText('Los dos lo modificaron')).not.toBeInTheDocument();
    expect(
      within(conflicted).getAllByRole('button', {
        name: 'Marcar este archivo como resuelto',
      }).length,
    ).toBeGreaterThan(0);
  });

  it('permite alternar los conflictos entre lista y árbol', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);

    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });

    expect(within(conflicted).getByRole('listbox', { name: 'En conflicto' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Árbol' }));
    expect(within(conflicted).getByRole('tree', { name: 'En conflicto' })).toBeInTheDocument();
  });

  it('marca un archivo como resuelto desde su acción rápida', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const markConflictResolved = vi.spyOn(ports.git, 'markConflictResolved');

    renderApp(ports);
    await openRepo(user, BITACORA_PATH);

    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });
    const row = within(conflicted).getByText('plan.md').closest('[role="option"]');

    expect(row).not.toBeNull();
    await user.click(
      within(row as HTMLElement).getByRole('button', {
        name: 'Marcar este archivo como resuelto',
      }),
    );

    await waitFor(() =>
      expect(markConflictResolved).toHaveBeenCalledWith('bitacora', 'docs/plan.md'),
    );
    expect(
      await within(screen.getByRole('region', { name: 'Resueltos' })).findByText('plan.md'),
    ).toBeInTheDocument();
  });

  it('dejar en preparados cierra Git sin commit y permite crear un commit normal', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const markConflictResolved = vi.spyOn(ports.git, 'markConflictResolved');
    const markConflictsResolved = vi.spyOn(ports.git, 'markConflictsResolved');
    const continueOperation = vi.spyOn(ports.git, 'continueOperation');
    const commit = vi.spyOn(ports.git, 'commit');
    const quitOperation = vi.spyOn(ports.git, 'quitOperation');

    renderApp(ports);
    await openRepo(user, BITACORA_PATH);

    await screen.findByRole('region', { name: 'En conflicto' });

    // Quedan ocho sin resolver, así que terminar no se puede todavía.
    expect(screen.getByRole('button', { name: 'Terminar merge' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Abortar merge' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Marcar todo como resuelto' }));

    await waitFor(() => expect(markConflictsResolved).toHaveBeenCalledTimes(1));
    expect(markConflictsResolved.mock.calls[0]?.[1]).toHaveLength(8);
    expect(markConflictResolved).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Terminar merge' })).toBeEnabled(),
    );
    expect(screen.getByText('Todos los conflictos están resueltos')).toBeInTheDocument();
    expect(
      screen.queryByText('El intento de merge ha generado conflictos'),
    ).not.toBeInTheDocument();

    // Resolver todos los archivos no libera por sí solo el resto de GitWorking.
    expect(
      screen.getByRole('grid', { name: 'Commits de bitacora' }).closest('[inert]'),
    ).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolver' })).not.toBeInTheDocument();

    const before = await ports.git.readRefs('bitacora');
    const staged = (await ports.git.readStatus('bitacora')).staged;
    await user.click(screen.getByRole('button', { name: 'Dejar en el staging' }));

    await waitFor(() =>
      expect(
        screen.getByRole('grid', { name: 'Commits de bitacora' }).closest('[inert]'),
      ).toBeNull(),
    );
    expect(
      screen.queryByText('Sin conflictos. Falta crear el commit de merge.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abortar merge' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Staging' })).toBeInTheDocument();
    expect(useWorkingStore.getState().selectedCommits).toEqual(new Set(['wip']));
    expect(continueOperation).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(quitOperation).toHaveBeenCalledExactlyOnceWith('bitacora');
    expect((await ports.git.readRepository('bitacora')).operation.kind).toBe('none');
    expect((await ports.git.readRefs('bitacora')).head).toEqual(before.head);
    expect((await ports.git.readStatus('bitacora')).staged).toEqual(staged);
    await user.type(
      screen.getByRole('textbox', { name: 'Resumen del commit' }),
      'Resolución preparada',
    );
    await user.click(screen.getByRole('button', { name: 'Hacer commit en main' }));
    await waitFor(() =>
      expect(commit).toHaveBeenCalledWith(
        'bitacora',
        expect.objectContaining({ summary: 'Resolución preparada' }),
      ),
    );
    expect(continueOperation).not.toHaveBeenCalled();
    await waitFor(async () => {
      expect((await ports.git.readRepository('bitacora')).operation.kind).toBe('none');
      expect(
        (await ports.git.readCommits('bitacora', { limit: 1 })).commits[0]?.parents,
      ).toHaveLength(1);
    });
  });

  it('mantiene el merge visible si falla dejar en preparados y permite reintentar', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const quit = vi
      .spyOn(ports.git, 'quitOperation')
      .mockRejectedValueOnce(new GitOperationError('resolve.stillConflicted', { count: 1 }));
    renderApp(ports);
    await openRepo(user, BITACORA_PATH);
    await screen.findByRole('region', { name: 'En conflicto' });
    await user.click(screen.getByRole('button', { name: 'Marcar todo como resuelto' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dejar en el staging' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Dejar en el staging' }));
    await screen.findByText('Todavía quedan 1 archivos en conflicto');
    expect((await ports.git.readRepository('bitacora')).operation.kind).toBe('merge');
    expect(screen.getByRole('button', { name: 'Abortar merge' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Staging' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dejar en el staging' }));
    await screen.findByRole('region', { name: 'Staging' });
    expect(quit).toHaveBeenCalledTimes(2);
    expect((await ports.git.readRepository('bitacora')).operation.kind).toBe('none');
  });

  it.each([true, false])(
    'vuelve a abrir Resolver al reintentar un merge (aborto observado: %s)',
    async (observeAbort) => {
      const user = userEvent.setup();
      const ports = makePorts();
      const abortOperation = vi.spyOn(ports.git, 'abortOperation');
      let notify: ((change: { worktree: boolean; git: boolean }) => void) | undefined;

      vi.spyOn(ports.git, 'watchRepository').mockImplementation((_id, listener) => {
        notify = listener;
        return Promise.resolve(() => undefined);
      });

      renderApp(ports);
      await openRepo(user, BITACORA_PATH);
      await screen.findByRole('region', { name: 'En conflicto' });

      await user.click(screen.getByRole('button', { name: 'Marcar todo como resuelto' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Dejar en el staging' })).toBeEnabled(),
      );
      if (observeAbort) {
        act(() => useWorkingStore.getState().requestAbort());
        await waitFor(() => expect(abortOperation).toHaveBeenCalledOnce());
        act(() => notify?.({ worktree: true, git: true }));
        await waitFor(() => expect(useResolveStore.getState().resolvedPaths.size).toBe(0));
      } else {
        // Un aborto y reintento desde la terminal pueden llegar en un solo aviso.
        await ports.git.abortOperation('bitacora');
      }

      await ports.git.merge('bitacora', 'redaccion').catch(() => undefined);
      act(() => notify?.({ worktree: true, git: true }));

      expect(await screen.findByRole('region', { name: 'En conflicto' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Cambios' })).not.toBeInTheDocument();
    },
  );

  it('cambia entre resultados resueltos individualmente y en bloque sin vaciar la vista', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);

    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });
    await user.click(within(conflicted).getByText('plan.md'));

    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });
    await user.click(within(resolver).getByRole('checkbox', { name: 'Agregar todo B, redaccion' }));
    await user.click(within(resolver).getByRole('button', { name: 'Marcar como resuelto' }));

    const resolved = await screen.findByRole('region', { name: 'Resueltos' });
    await waitFor(() => expect(within(resolved).getByText('plan.md')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Marcar todo como resuelto' }));
    await waitFor(() => expect(within(resolved).getByText('palette.css')).toBeInTheDocument());

    await user.click(within(resolved).getByText('plan.md'));
    expect(await screen.findByRole('region', { name: 'docs/plan.md' })).toBeVisible();

    await user.click(within(resolved).getByText('palette.css'));
    const bulkResult = await screen.findByRole('region', { name: 'src/design/palette.css' });

    expect(bulkResult).toBeVisible();
    expect(within(bulkResult).getByText('Resultado final resuelto')).toBeVisible();
    expect(
      within(bulkResult).getByRole('textbox', { name: 'Resultado final resuelto' }),
    ).not.toBeEmptyDOMElement();
  });

  it.each([false, true])(
    'recupera la resolución al reabrir (dejada en preparados: %s)',
    async (keepStaged) => {
      const user = userEvent.setup();
      const ports = makePorts();
      const mounted = renderApp(ports);

      await openRepo(user, BITACORA_PATH);
      await screen.findByRole('region', { name: 'En conflicto' });
      await user.click(screen.getByRole('button', { name: 'Marcar todo como resuelto' }));

      const resolved = await screen.findByRole('region', { name: 'Resueltos' });
      await waitFor(() => expect(within(resolved).getByText('palette.css')).toBeInTheDocument());

      if (keepStaged) {
        await user.click(screen.getByRole('button', { name: 'Dejar en el staging' }));
        await screen.findByRole('region', { name: 'Staging' });
      }

      const shell = useShellStore.getState();
      const snapshot = normalizeSession({ version: 1, tabs: shell.tabs, activeId: shell.activeId });
      const savedSurface = snapshot.tabs[0]?.surface;
      expect(savedSurface?.kind).toBe('working');
      if (keepStaged) {
        expect(
          savedSurface?.kind === 'working' ? savedSurface.resolution : undefined,
        ).toBeUndefined();
      } else {
        expect(savedSurface?.kind === 'working' ? savedSurface.resolution?.paths : []).toContain(
          'src/design/palette.css',
        );
      }

      mounted.unmount();
      expect(useResolveStore.getState().resolvedPaths.size).toBe(0);
      const closedSurface = useShellStore.getState().tabs[0]?.surface;
      if (keepStaged) {
        expect(
          closedSurface?.kind === 'working' ? closedSurface.resolution : undefined,
        ).toBeUndefined();
      } else {
        expect(closedSurface?.kind === 'working' ? closedSurface.resolution?.paths : []).toContain(
          'src/design/palette.css',
        );
      }

      restoreShellSession(snapshot);
      renderApp(ports);

      if (keepStaged) {
        const stage = await screen.findByRole('region', { name: 'Staging' });
        expect(await within(stage).findByText('palette.css')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'En conflicto' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Abortar merge' })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Resumen del commit' })).toBeEnabled();
        return;
      }

      const restored = await screen.findByRole('region', { name: 'Resueltos' });
      expect(await within(restored).findByText('palette.css')).toBeInTheDocument();
      expect(
        within(screen.getByRole('region', { name: 'En conflicto' })).queryAllByRole('option'),
      ).toHaveLength(0);

      await user.click(within(restored).getByText('palette.css'));
      const result = await screen.findByRole('region', { name: 'src/design/palette.css' });
      expect(
        within(result).getByRole('textbox', { name: 'Resultado final resuelto' }),
      ).not.toBeEmptyDOMElement();
    },
  );
  it('blocks saving a malformed decoding until a valid encoding is selected', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const save = vi.spyOn(ports.git, 'resolveConflict');
    renderApp(ports);
    await openRepo(user, BITACORA_PATH);
    await user.click(
      within(await screen.findByRole('region', { name: 'En conflicto' })).getByText('plan.md'),
    );
    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });
    await user.selectOptions(
      within(resolver).getByRole('combobox', { name: 'Codificación' }),
      'us-ascii',
    );
    await within(resolver).findByRole('status', { name: /Hay bytes inválidos/ });
    await user.click(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' }));
    expect(within(resolver).getByRole('button', { name: 'Marcar como resuelto' })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
    expect(within(resolver).getByRole('combobox', { name: 'Codificación' })).toBeEnabled();
    const invalidText = within(resolver).getByRole('textbox', { name: 'Resultado' }).textContent;
    await user.selectOptions(
      within(resolver).getByRole('combobox', { name: 'Codificación' }),
      'utf-8',
    );
    const confirmation = await screen.findByRole('dialog', { name: 'Volver a leer como UTF-8' });
    await user.click(within(confirmation).getByRole('button', { name: 'Cancelar' }));
    expect(within(resolver).getByRole('combobox', { name: 'Codificación' })).toHaveValue(
      'us-ascii',
    );
    expect(within(resolver).getByRole('textbox', { name: 'Resultado' }).textContent).toBe(
      invalidText,
    );
    expect(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' })).toBeChecked();
    await user.selectOptions(
      within(resolver).getByRole('combobox', { name: 'Codificación' }),
      'utf-8',
    );
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Volver a leer como UTF-8' })).getByRole(
        'button',
        {
          name: 'Cambiar y reiniciar resolución',
        },
      ),
    );
    await waitFor(() =>
      expect(
        within(resolver).queryByRole('status', { name: /Hay bytes inválidos/ }),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' }),
    ).not.toBeChecked();
    await user.click(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' }));
    expect(within(resolver).getByRole('button', { name: 'Marcar como resuelto' })).toBeEnabled();
  });

  it('redecodes conflict sides and saves with the selected encoding', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const read = vi.spyOn(ports.git, 'readConflict');
    const save = vi.spyOn(ports.git, 'resolveConflict');
    renderApp(ports);
    await openRepo(user, BITACORA_PATH);
    await user.click(
      within(await screen.findByRole('region', { name: 'En conflicto' })).getByText('plan.md'),
    );
    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });
    const combo = within(resolver).getByRole('combobox', { name: 'Codificación' });
    await user.selectOptions(combo, 'windows-1252');
    await waitFor(() =>
      expect(read).toHaveBeenLastCalledWith(
        'bitacora',
        'docs/plan.md',
        expect.objectContaining({ encoding: 'windows-1252' }),
      ),
    );
    await waitFor(() =>
      expect(resolver.querySelector('[data-encoding="windows-1252"]')).not.toBeNull(),
    );
    await user.click(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' }));
    expect(within(resolver).getByRole('combobox', { name: 'Codificación' })).toBeEnabled();
    await user.click(within(resolver).getByRole('button', { name: 'Marcar como resuelto' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'bitacora',
        'docs/plan.md',
        expect.any(String),
        expect.objectContaining({ encoding: 'windows-1252' }),
      ),
    );
  });

  it.each(['seleccionar B', 'corregir el resultado'] as const)(
    'permite guardar sin caracteres inválidos al %s aunque A tenga errores de lectura',
    async (action) => {
      const user = userEvent.setup();
      const ports = makePorts();
      const original = await ports.git.readConflict('bitacora', 'docs/plan.md');
      vi.spyOn(ports.git, 'readConflict').mockResolvedValue({
        ...original,
        base: 'inicio\nbase\nfin\n',
        ours: 'inicio\nmal \uFFFD\nfin\n',
        theirs: 'inicio\ntexto correcto\nfin\n',
        encoding: 'utf-8',
        decodingErrors: true,
      });
      const save = vi.spyOn(ports.git, 'resolveConflict');
      renderApp(ports);
      await openRepo(user, BITACORA_PATH);
      await user.click(
        within(await screen.findByRole('region', { name: 'En conflicto' })).getByText('plan.md'),
      );
      const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });
      if (action === 'seleccionar B') {
        await user.click(
          within(resolver).getByRole('checkbox', { name: 'Agregar todo B, redaccion' }),
        );
      } else {
        await user.click(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' }));
        expect(
          within(resolver).getByRole('button', { name: 'Marcar como resuelto' }),
        ).toBeDisabled();
        await user.click(within(resolver).getByRole('textbox', { name: 'Resultado' }));
        await user.keyboard('{Control>}a{/Control}texto corregido');
      }
      expect(within(resolver).getByRole('button', { name: 'Marcar como resuelto' })).toBeEnabled();
      expect(within(resolver).queryByText(/El resultado contiene �/)).not.toBeInTheDocument();
      await user.click(within(resolver).getByRole('button', { name: 'Marcar como resuelto' }));
      await waitFor(() => expect(save).toHaveBeenCalled());
      expect(save.mock.calls[0]?.[2]).not.toContain('\uFFFD');
    },
  );

  it('integra guardarMetricas automáticamente y guarda solo las decisiones pendientes con su revisión', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const original = await ports.git.readConflict('bitacora', 'docs/plan.md');
    vi.spyOn(ports.git, 'readConflict').mockResolvedValue({
      ...original,
      base: 'inicio\nbase\nprocesarDatos();\ncerrarConexion();\n',
      ours: 'inicio\nA\nprocesarDatos();\nguardarMetricas();\ncerrarConexion();\n',
      theirs: 'inicio\nB\nprocesarDatos();\ncerrarConexion();\n',
    });
    const save = vi.spyOn(ports.git, 'resolveConflict');
    renderApp(ports);
    await openRepo(user, BITACORA_PATH);
    await user.click(
      within(await screen.findByRole('region', { name: 'En conflicto' })).getByText('plan.md'),
    );
    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });
    expect(within(resolver).getByRole('textbox', { name: 'Resultado' })).toHaveTextContent(
      'guardarMetricas();',
    );
    expect(within(resolver).getByText('Bloque 1 de 1')).toBeVisible();
    expect(
      within(resolver).getAllByRole('checkbox', { name: 'Agregar el bloque 1 completo' }),
    ).toHaveLength(2);
    expect(
      within(resolver).queryByRole('checkbox', { name: /Agregar la línea 4/ }),
    ).not.toBeInTheDocument();
    await user.click(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' }));
    await user.click(within(resolver).getByRole('button', { name: 'Marcar como resuelto' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        'bitacora',
        'docs/plan.md',
        'inicio\nA\nprocesarDatos();\nguardarMetricas();\ncerrarConexion();\n',
        { expectedRevision: original.revision, encoding: 'utf-8' },
      ),
    );
  });

  it('un fallo al guardar conserva el resultado, explica el error y permite reintentar', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    vi.spyOn(ports.git, 'resolveConflict').mockRejectedValue(
      new GitOperationError('write.stale', { path: 'docs/plan.md' }),
    );
    renderApp(ports);
    await openRepo(user, BITACORA_PATH);
    await user.click(
      within(await screen.findByRole('region', { name: 'En conflicto' })).getByText('plan.md'),
    );
    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });
    await user.click(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' }));
    const before = within(resolver).getByRole('textbox', { name: 'Resultado' }).textContent;
    await user.click(within(resolver).getByRole('button', { name: 'Marcar como resuelto' }));
    await waitFor(() => expect(within(resolver).getByRole('alert')).toBeVisible());
    expect(within(resolver).getByRole('textbox', { name: 'Resultado' }).textContent).toBe(before);
    expect(within(resolver).getByRole('button', { name: 'Marcar como resuelto' })).toBeEnabled();
  });

  it('escribir en un conflicto pendiente resuelve ese bloque y permite añadir ambos lados', async () => {
    const user = userEvent.setup();
    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);
    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });
    await user.click(within(conflicted).getByText('plan.md'));
    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });
    const pending = within(resolver).getByRole('button', {
      name: /conflictos por resolver$/,
    }).textContent;
    const slot = resolver.querySelector<HTMLElement>('.gitthul-editable-spacer');
    expect(slot).not.toBeNull();
    fireEvent.mouseDown(slot!);
    expect(
      within(resolver).getByRole('button', { name: /conflictos por resolver$/ }).textContent,
    ).toBe(pending);
    await user.keyboard('solucionPropia');
    const resultEditor = within(resolver).getByRole('textbox', { name: 'Resultado' });
    expect(resultEditor).toHaveTextContent('solucionPropia');
    expect(
      within(resolver).getByRole('button', { name: /conflictos por resolver$/ }).textContent,
    ).not.toBe(pending);
    for (let index = 0; index < 2; index++) {
      await user.click(
        within(resolver).getAllByRole('checkbox', { name: 'Agregar el bloque 1 completo' })[index]!,
      );
      expect(resultEditor).toHaveTextContent('solucionPropia');
    }
    expect(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' })).toBeEnabled();
    expect(within(resolver).getByText(/Bloque 1 de/)).toBeVisible();
  });

  it('abrir un conflicto monta el resolutor con las dos ramas y sus bloques', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);

    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });

    await user.click(within(conflicted).getByText('plan.md'));

    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });

    /*
     * Los dos lados se rotulan con su rama, nunca «el nuestro» — invariante 5.
     * Se busca la cabecera de cada panel y no una región: desde que scrollea el
     * propio editor, el lado ya no es un contenedor con nombre accesible, es un
     * rótulo encima de un visor.
     */
    expect(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' })).toBeVisible();
    expect(
      within(resolver).getByRole('checkbox', { name: 'Agregar todo B, redaccion' }),
    ).toBeVisible();

    // Con bloques sin resolver, la acción final muestra cuántos faltan y no se puede pulsar.
    const resolveButton = within(resolver).getByRole('button', {
      name: /conflictos por resolver$/,
    });

    expect(resolveButton).toBeDisabled();

    const pending = resolveButton.textContent ?? '';

    expect(within(resolver).getByText(/Bloque 1 de/)).toBeVisible();
    expect(
      within(resolver).getAllByRole('checkbox', { name: 'Agregar el bloque 1 completo' }),
    ).toHaveLength(2);
    expect(
      within(resolver).getAllByRole('button', { name: /Agregar la línea \d+ de main/ }).length,
    ).toBeGreaterThan(0);

    const scrollers = [...resolver.querySelectorAll<HTMLElement>('.cm-scroller')];

    expect(scrollers).toHaveLength(3);

    for (const scroller of scrollers) {
      Object.defineProperties(scroller, {
        scrollTop: { value: 0, writable: true, configurable: true },
        scrollHeight: { value: 1000, configurable: true },
        clientHeight: { value: 300, configurable: true },
      });
    }

    const firstScroller = scrollers[0];

    if (!firstScroller) throw new Error('Falta el primer panel del resolutor');

    await waitFor(() =>
      expect(scrollers.every((scroller) => !scroller.dataset.preservingScroll)).toBe(true),
    );
    firstScroller.scrollTop = 240;
    fireEvent.scroll(firstScroller);

    expect(scrollers[1]?.scrollTop).toBe(240);
    expect(scrollers[2]?.scrollTop).toBe(240);

    const firstBlockButton = within(resolver).getAllByRole('checkbox', {
      name: 'Agregar el bloque 1 completo',
    })[0]!;

    await user.click(firstBlockButton);

    expect(
      within(resolver).getByRole('button', { name: /conflictos por resolver$/ }).textContent,
    ).not.toBe(pending);
    const selectedBlockButton = within(resolver).getAllByRole('checkbox', {
      name: 'Agregar el bloque 1 completo',
    })[0]!;

    expect(selectedBlockButton).toBeChecked();
    expect(scrollers.map((scroller) => scroller.scrollTop)).toEqual([240, 240, 240]);
    expect(firstScroller.querySelector('[class*="chosenLine"]')).not.toBeNull();
    expect(selectedBlockButton.closest('.gitthul-block-range')).toHaveAttribute(
      'data-tone',
      'ours',
    );
    const resultEditor = scrollers[2]?.querySelector('.cm-content');
    if (!resultEditor) throw new Error('Falta el editor de resultado');
    expect(fireEvent.contextMenu(resultEditor)).toBe(false);

    await user.click(selectedBlockButton);
    expect(scrollers.map((scroller) => scroller.scrollTop)).toEqual([240, 240, 240]);
    const lineChoice = within(resolver)
      .getAllByRole('button', { name: /Agregar la línea \d+ de main/ })
      .at(-1)!;
    await user.click(lineChoice);
    expect(within(resolver).getByText(/Bloque 1 de/)).toBeVisible();
    expect(scrollers.map((scroller) => scroller.scrollTop)).toEqual([240, 240, 240]);
    await user.click(
      within(resolver).getByRole('button', { name: lineChoice.getAttribute('aria-label') ?? '' }),
    );

    expect(
      within(resolver).getByRole('button', { name: /conflictos por resolver$/ }).textContent,
    ).toBe(pending);
  });

  it('lo que pasa del tope se resuelve con la ficha, sin tres paneles', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);

    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });

    await user.click(within(conflicted).getByText('traducciones.po'));

    const card = await screen.findByRole('region', { name: 'assets/traducciones.po' });

    expect(
      within(card).getByText(/61240 líneas y el editor admite hasta 50000/),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('region', { name: 'main' })).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Quedarse con el de main' }));

    const resolved = await screen.findByRole('region', { name: 'Resueltos' });

    await waitFor(() => {
      expect(within(resolved).getByText('traducciones.po')).toBeInTheDocument();
    });
  });
  it('marcar como resuelto escribe el resultado y vuelve a las listas', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);

    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });

    await user.click(within(conflicted).getByText('plan.md'));

    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });
    const allA = within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' });

    await user.click(allA);

    const finish = within(resolver).getByRole('button', { name: 'Marcar como resuelto' });

    expect(finish).toBeEnabled();

    await user.click(finish);

    // Vuelve a las listas —no encadena al siguiente archivo— y el archivo ya
    // está en Resueltos.
    const resolved = await screen.findByRole('region', { name: 'Resueltos' });

    await waitFor(() => {
      expect(within(resolved).getByText('plan.md')).toBeInTheDocument();
    });

    expect(screen.getByRole('region', { name: 'En conflicto' })).toBeInTheDocument();

    // Un clic en el resuelto conserva la lectura del resultado y la procedencia A/B.
    await user.click(within(resolved).getByText('plan.md'));

    const finalResult = await screen.findByRole('region', { name: 'docs/plan.md' });

    expect(within(finalResult).getByText('Resultado final resuelto')).toBeInTheDocument();
    expect(finalResult.closest('[class*="centerPane"]')).not.toBeNull();
    expect(finalResult.closest('[inert]')).toBeNull();
    expect(screen.getByRole('region', { name: 'Resueltos' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'En conflicto' })).toBeVisible();
    expect(within(finalResult).getByText(/Bloque 1 · main/)).toBeInTheDocument();

    await user.click(within(finalResult).getByRole('button', { name: 'Cerrar resultado' }));
    const resolvedPlanRow = within(resolved).getByText('plan.md').closest('[role="option"]');

    if (!(resolvedPlanRow instanceof HTMLElement)) throw new Error('Falta la fila resuelta');

    await user.click(
      within(resolvedPlanRow).getByRole('button', { name: 'Devolver este archivo a conflictos' }),
    );

    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'En conflicto' })).getByText('plan.md'),
      ).toBeInTheDocument();
    });
  });
  it('editar el resultado a mano apaga los bloques, y se puede volver a ellos', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);

    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });

    await user.click(within(conflicted).getByText('plan.md'));

    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });

    /*
     * La escritura se simula por el store y no tecleando en el editor: quien
     * recibe las teclas es CodeMirror, que en jsdom no monta su vista. Lo que
     * esta prueba fija no es que se pueda escribir —eso lo hace el primitivo—
     * sino qué pasa con los bloques cuando hay texto escrito a mano.
     */
    act(() => {
      useResolveStore.getState().setManual('docs/plan.md', 'lo escribo yo\n');
    });

    expect(
      within(resolver).getByText('Edición manual: las acciones por bloque están desactivadas'),
    ).toBeVisible();
    expect(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' })).toBeDisabled();

    // Con texto a mano ya no queda nada pendiente: marcar se puede.
    expect(within(resolver).getByRole('button', { name: 'Marcar como resuelto' })).toBeEnabled();

    const back = within(resolver).getByRole('button', { name: 'Volver a los bloques' });

    await user.click(back);

    expect(within(resolver).getByRole('checkbox', { name: 'Agregar todo A, main' })).toBeEnabled();
  });
  it('señalar una rama lleva el foco a su nodo del grafo', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, GITTHUL_PATH);

    const panel = await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const locals = within(panel).getByRole('group', { name: 'Ramas locales' });

    const before = useWorkingStore.getState().goTo;

    fireEvent.mouseDown(within(locals).getByText('dev'), { button: 0 });

    const after = useWorkingStore.getState().goTo;

    // La tabla se lleva al commit de la rama señalada — punto 15. Si ese commit
    // todavía no está paginado, no salta: está decidido así en `CommitTable`.
    expect(after?.sha).toBeDefined();
    expect(after?.nonce).not.toBe(before?.nonce);
  });
  it('un solo clic abre el resolutor, sin doble clic ni menú', async () => {
    const user = userEvent.setup();

    renderApp(makePorts());
    await openRepo(user, BITACORA_PATH);

    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });

    await user.click(within(conflicted).getByText('palette.css'));

    expect(
      await screen.findByRole('region', { name: 'src/design/palette.css' }),
    ).toBeInTheDocument();
  });
});
