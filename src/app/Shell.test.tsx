import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { createMockLibraryPort } from '@core/adapters/mock/mockLibraryPort';
import { selectPorts } from '@core/adapters/selectPorts';
import { normalizeSession } from '@core/domain/session';
import { ThemeProvider } from '@design/ThemeProvider';
import type { ThemeSettings } from '@design/theme';
import { useWorkingStore } from '@features/working/workingStore';
import { useRepositoriesStore } from '@features/repositories/repositoriesStore';
import { I18nProvider } from '@i18n/I18nProvider';
import type { Locale } from '@i18n/locales';
import { useVirtualViewport } from '../test/virtualViewport';

import { App } from './App';
import { PortsContext } from './PortsContext';
import { restoreShellSession, useShellStore } from './shellStore';

/*
 * El adaptador falso sin latencia: el shell ya pide los repositorios al puerto,
 * y esperar de verdad los ciento ochenta milisegundos que finge en desarrollo
 * volvería lentas y frágiles todas las pruebas de la tira de pestañas. El
 * biblioteca va en memoria para que lo que una prueba escriba no llegue a la
 * siguiente por el almacenamiento del navegador.
 */
const ports = {
  ...selectPorts(),
  git: createMockGitPort({ latency: NO_LATENCY }),
  library: createMockLibraryPort(),
};

function renderShell(
  locale: Locale = 'es-MX',
  themeOverrides?: Partial<ThemeSettings>,
  portOverrides = ports,
) {
  return render(
    <PortsContext value={portOverrides}>
      <ThemeProvider initialSettings={{ theme: 'thul', mode: 'dark', ...themeOverrides }}>
        <I18nProvider initialLocale={locale}>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </PortsContext>,
  );
}

/** Los rótulos de las pestañas, en el orden en que están en la tira. */
function tabNames(): string[] {
  return within(screen.getByRole('list', { name: 'Pestañas abiertas' }))
    .queryAllByRole('button', { name: /.*/ })
    .filter(
      (button) => button.hasAttribute('aria-current') || button.className.includes('activate'),
    )
    .map((button) => button.textContent ?? '');
}

/**
 * Un lanzador de la barra inferior.
 *
 * Se acota al grupo porque la fila de acciones de Repositorios también ofrece
 * Terminal con el mismo nombre: es el mismo gesto por dos caminos.
 */
function launcher(name: string): HTMLElement {
  return within(screen.getByRole('group', { name: 'Abrir vistas' })).getByRole('button', { name });
}

/**
 * Abrir un repositorio como se abre de verdad: doble selección sobre su fila.
 *
 * El primer clic selecciona y el segundo, ya sobre la fila seleccionada, abre.
 * Se busca por la carpeta porque el worktree comparte nombre con su repositorio
 * padre y lo único que los distingue en la fila es esa ruta, exacta.
 */
async function openRepo(user: ReturnType<typeof userEvent.setup>, path: string) {
  const rows = await screen.findAllByRole('option');
  const row = rows.find((candidate) => within(candidate).queryByText(path) !== null);

  if (!row) throw new Error(`No hay ninguna fila en la carpeta ${path}`);

  const target = within(row).getByText(path);

  await user.click(target);

  // El segundo clic va a mano: dos `click()` seguidos sobre lo mismo son un
  // doble clic para userEvent, y el doble clic es el otro camino de abrir, no
  // este. Lo que se está comprobando aquí es la segunda pulsación simple, con
  // sus tres eventos, porque la fila anota en `mousedown` y abre en `click`.
  const second = { button: 0, detail: 1 };

  fireEvent.mouseDown(target, second);
  fireEvent.mouseUp(target, second);
  fireEvent.click(target, second);

  // Abrir marca la apertura en dos puertos antes de abrir la pestaña, así que
  // hasta aquí no ha pasado nada todavía.
  await waitFor(() => {
    expect(tabNames()).not.toEqual([]);
  });
}

beforeEach(() => {
  useShellStore.getState().reset();
  useRepositoriesStore.getState().reset();
});

describe('Shell', () => {
  useVirtualViewport();

  /*
   * Repositorios no es una pestaña: es el hogar. La tira arranca vacía y quien
   * marca dónde se está es su botón de la barra, que es su pestaña.
   */
  it('arranca en Repositorios, sin ninguna pestaña', () => {
    renderShell();

    expect(tabNames()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Abrir «Acerca de GitThul»' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a Repositorios' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  /*
   * Guardia del piso observable de `antes-de-codex`. Las suites de cada feature
   * prueban su comportamiento fino; esta solo protege que el shell no vuelva a
   * sustituir una superficie completa por un placeholder durante una migración
   * de puertos o backend.
   */
  it('conserva accesibles todas las superficies principales desde el shell', async () => {
    const user = userEvent.setup();

    renderShell();

    const repositoryActions = await screen.findByRole('toolbar', {
      name: 'Acciones de repositorio',
    });

    expect(
      within(repositoryActions).getByRole('button', {
        name: 'Abrir una carpeta como repositorio',
      }),
    ).toBeInTheDocument();
    expect(
      within(repositoryActions).getByRole('button', { name: 'Crear un repositorio' }),
    ).toBeInTheDocument();
    expect(
      within(repositoryActions).getByRole('button', { name: 'Clonar un repositorio' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Espacios' })).toBeInTheDocument();

    await openRepo(user, '/home/example/projects/gitthul');

    expect(
      await screen.findByRole('region', { name: 'Referencias de gitthul' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('grid', { name: 'Commits de gitthul' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cambios' })).toBeInTheDocument();

    await user.click(launcher('Abrir una pestaña de terminal'));
    expect(screen.getByRole('textbox', { name: 'Escribe un comando…' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abrir Configuraciones' }));

    const settings = screen.getByRole('navigation', { name: 'Secciones de configuraciones' });

    expect(within(settings).getAllByRole('tab')).toHaveLength(8);

    await user.click(screen.getByRole('button', { name: 'Ir a Repositorios' }));
    await openRepo(user, '/home/example/projects/bitacora');

    const conflicted = await screen.findByRole('region', { name: 'En conflicto' });

    expect(screen.getByRole('region', { name: 'Resueltos' })).toBeInTheDocument();
    await user.click(within(conflicted).getByText('plan.md'));

    const resolver = await screen.findByRole('region', { name: 'docs/plan.md' });

    expect(within(resolver).getByRole('textbox', { name: 'A · main' })).toBeInTheDocument();
    expect(within(resolver).getByRole('textbox', { name: 'B · redaccion' })).toBeInTheDocument();
    expect(within(resolver).getByRole('textbox', { name: 'Resultado' })).toBeInTheDocument();
  }, 15_000);

  it('restaura descriptores, pero monta solo la pestaña activa hasta enfocarla', async () => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const readRepository = vi.spyOn(git, 'readRepository');

    restoreShellSession(
      normalizeSession({
        tabs: [
          {
            id: 'tab-1',
            surface: {
              kind: 'working',
              repoId: 'gitthul',
              repoName: 'gitthul',
              repoPath: '/home/example/projects/gitthul',
              branch: 'main',
            },
          },
          {
            id: 'tab-2',
            surface: {
              kind: 'working',
              repoId: 'bitacora',
              repoName: 'bitacora',
              repoPath: '/home/example/projects/bitacora',
              branch: 'main',
            },
          },
        ],
        activeId: 'tab-2',
      }),
    );

    renderShell('es-MX', undefined, { ...ports, git });

    await waitFor(() =>
      expect(readRepository.mock.calls.some(([repoId]) => repoId === 'bitacora')).toBe(true),
    );
    expect(readRepository.mock.calls.some(([repoId]) => repoId === 'gitthul')).toBe(false);

    act(() => useShellStore.getState().activateTab('tab-1'));
    await waitFor(() =>
      expect(readRepository.mock.calls.some(([repoId]) => repoId === 'gitthul')).toBe(true),
    );
  });

  it('el botón de Repositorios deja de marcarse al abrir una pestaña, y vuelve al pulsarlo', async () => {
    const user = userEvent.setup();

    renderShell();

    const home = () => screen.getByRole('button', { name: 'Ir a Repositorios' });

    await user.click(launcher('Abrir una pestaña de terminal'));

    expect(home()).not.toHaveAttribute('aria-current');

    await user.click(home());

    expect(home()).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Abrir «Acerca de GitThul»' })).toBeInTheDocument();

    // Volver al hogar no cierra nada: la terminal sigue en la tira, sin marcar.
    expect(tabNames()).toEqual(['Terminal']);
    expect(
      within(screen.getByRole('list', { name: 'Pestañas abiertas' })).getByRole('button', {
        name: 'Terminal',
      }),
    ).not.toHaveAttribute('aria-current');
  });

  it('la tira de pestañas dice qué se está mirando', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.click(launcher('Abrir una pestaña de terminal'));

    const strip = screen.getByRole('list', { name: 'Pestañas abiertas' });

    expect(within(strip).getByText('Terminal')).toBeInTheDocument();
  });

  it('mantiene las vistas y la terminal sin duplicar la barra ni los bordes nativos', async () => {
    const { container } = renderShell();

    expect(screen.queryByRole('banner', { name: 'Barra de título' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(0);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Barra inferior' })).toBeInTheDocument();

    await userEvent.setup().click(launcher('Abrir una pestaña de terminal'));
    expect(screen.getByRole('textbox', { name: 'Escribe un comando…' })).toBeInTheDocument();
  });
});

describe('pestañas', () => {
  useVirtualViewport();

  it('el menú copia datos del repo y cierra un espacio respetando pertenencias compartidas', async () => {
    const user = userEvent.setup();
    const library = createMockLibraryPort();
    const writeText = vi.fn(() => Promise.resolve());

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const trabajo = await library.createSpace('Trabajo');
    const trabajoId = trabajo.spaces[0]!.id;
    const personal = await library.createSpace('Personal');
    const personalId = personal.spaces[1]!.id;

    await library.addToSpace(trabajoId, 'gitthul');
    await library.addToSpace(trabajoId, 'bitacora');
    await library.addToSpace(personalId, 'gitthul');
    await library.addToSpace(personalId, 'gitthul-worktree');

    const shell = useShellStore.getState();
    shell.openWorking({
      repoId: 'gitthul',
      repoName: 'gitthul',
      repoPath: '/home/example/projects/gitthul',
      branch: 'main',
    });
    const gitthulId = useShellStore.getState().activeId!;
    useShellStore.getState().openTerminalFrom(gitthulId);
    useShellStore.getState().openWorking({
      repoId: 'bitacora',
      repoName: 'bitacora',
      repoPath: '/home/example/projects/bitacora',
      branch: 'main',
    });
    useShellStore.getState().openWorking({
      repoId: 'gitthul-worktree',
      repoName: 'gitthul',
      repoPath: '/home/example/projects/gitthul-f2-grafo',
      branch: 'f2-grafo',
      worktreeOf: 'gitthul',
    });

    renderShell('es-MX', undefined, { ...ports, library });

    const strip = screen.getByRole('list', { name: 'Pestañas abiertas' });
    const gitthulTab = within(strip).getAllByRole('button', { name: 'gitthul' })[0]!;

    fireEvent.contextMenu(gitthulTab, { clientX: 20, clientY: 20 });
    await user.click(screen.getByRole('menuitem', { name: 'Copiar la ruta del repositorio' }));
    expect(writeText).toHaveBeenCalledWith('/home/example/projects/gitthul');

    fireEvent.contextMenu(gitthulTab, { clientX: 20, clientY: 20 });
    await user.click(
      screen.getByRole('menuitem', {
        name: 'Cerrar todas las pestañas con repositorios de Trabajo',
      }),
    );

    await waitFor(() => {
      expect(useShellStore.getState().tabs.map((tab) => tab.context.repository?.repoId)).toEqual([
        'gitthul',
        'gitthul',
        'gitthul-worktree',
      ]);
    });
  });

  it('el botón de la barra abre una pestaña independiente de terminal', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.click(launcher('Abrir una pestaña de terminal'));

    expect(tabNames()).toEqual(['Terminal']);
    // La vista real de la terminal tiene un campo de entrada de comandos.
    expect(screen.getByRole('textbox', { name: 'Escribe un comando…' })).toBeInTheDocument();
  });

  it('abre terminales contextuales aisladas y conserva sus dos GitWorking', async () => {
    const user = userEvent.setup();

    renderShell();
    await openRepo(user, '/home/example/projects/gitthul');
    await user.click(
      within(screen.getByRole('toolbar', { name: 'Barra de acciones de GitWorking' })).getByRole(
        'button',
        { name: 'Abrir otra pestaña de terminal desde la pestaña activa' },
      ),
    );

    expect(screen.getByText('gitthul$')).toBeInTheDocument();
    expect(
      await within(await screen.findByRole('grid', { name: 'Referencias' })).findAllByTitle('main'),
    ).not.toHaveLength(0);
    expect(tabNames()).toEqual(['gitthul', 'gitthul']);

    await user.click(screen.getByRole('button', { name: 'Ir a Repositorios' }));
    await openRepo(user, '/home/example/projects/gitthul-f2-grafo');
    await user.click(
      within(screen.getByRole('toolbar', { name: 'Barra de acciones de GitWorking' })).getByRole(
        'button',
        { name: 'Abrir otra pestaña de terminal desde la pestaña activa' },
      ),
    );

    const state = useShellStore.getState();
    const workingTabs = state.tabs.filter((tab) => tab.surface.kind === 'working');
    const terminalTabs = state.tabs.filter((tab) => tab.surface.kind === 'terminal');

    expect(workingTabs).toHaveLength(2);
    expect(terminalTabs).toHaveLength(2);
    expect(terminalTabs.map((tab) => tab.surface.kind === 'terminal' && tab.surface.cwd)).toEqual([
      '/home/example/projects/gitthul',
      '/home/example/projects/gitthul-f2-grafo',
    ]);
    expect(terminalTabs.map((tab) => tab.context.repository?.repoId)).toEqual([
      'gitthul',
      'gitthul-worktree',
    ]);
    expect(tabNames()).toEqual(['gitthul', 'gitthul', 'gitthul', 'gitthul']);
    expect(screen.getByText('gitthul-f2-grafo$')).toBeInTheDocument();

    act(() => {
      useShellStore.getState().activateTab(terminalTabs[0]!.id);
    });

    expect(screen.getByText('gitthul$')).toBeInTheDocument();
    expect(
      useShellStore.getState().tabs.find((tab) => tab.id === terminalTabs[1]!.id)?.surface,
    ).toMatchObject({
      kind: 'terminal',
      cwd: '/home/example/projects/gitthul-f2-grafo',
    });
  });

  it('desde una terminal contextual vuelve a la pestaña GitWorking ya abierta', async () => {
    const user = userEvent.setup();

    renderShell();
    await openRepo(user, '/home/example/projects/gitthul');
    await user.click(
      within(screen.getByRole('toolbar', { name: 'Barra de acciones de GitWorking' })).getByRole(
        'button',
        { name: 'Abrir otra pestaña de terminal desde la pestaña activa' },
      ),
    );

    expect(useShellStore.getState().tabs).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Abrir GitWorking de este repositorio' }));

    const state = useShellStore.getState();

    expect(state.tabs).toHaveLength(2);
    expect(state.tabs.find((tab) => tab.id === state.activeId)?.surface).toMatchObject({
      kind: 'working',
      repoId: 'gitthul',
    });
    expect(
      await screen.findByRole('region', { name: 'Referencias de gitthul' }),
    ).toBeInTheDocument();
  });

  // Sin historia debajo no hay nada a lo que volver, así que se va la pestaña entera.
  it('cerrar una superficie independiente cierra la pestaña', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.click(launcher('Abrir una pestaña de terminal'));
    await user.keyboard('{Control>}w{/Control}');

    expect(tabNames()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Abrir «Acerca de GitThul»' })).toBeInTheDocument();
  });

  it('la × cierra la pestaña', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.click(launcher('Abrir una pestaña de terminal'));
    await user.click(screen.getByRole('button', { name: 'Cerrar la pestaña Terminal' }));

    expect(tabNames()).toEqual([]);
  });

  it('la pestaña de terminal no muestra acciones contextuales', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.click(launcher('Abrir una pestaña de terminal'));

    expect(screen.getByRole('textbox', { name: 'Escribe un comando…' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Abrir la terminal en Terminal')).not.toBeInTheDocument();
  });

  it('una pestaña de GitWorking muestra solo el nombre del repositorio', async () => {
    const user = userEvent.setup();

    renderShell();

    await openRepo(user, '/home/example/projects/gitthul');

    expect(tabNames()).toEqual(['gitthul']);
    expect(
      await screen.findByRole('region', { name: 'Referencias de gitthul' }),
    ).toBeInTheDocument();
  });

  it('la pestaña de un worktree muestra solo el nombre del repositorio', async () => {
    const user = userEvent.setup();

    renderShell();

    await openRepo(user, '/home/example/projects/gitthul-f2-grafo');

    expect(tabNames()).toEqual(['gitthul']);
  });
});

describe('atajos globales', () => {
  useVirtualViewport();

  it('abren una pestaña de terminal', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.keyboard('{Control>}{Shift>}t{/Shift}{/Control}');

    expect(tabNames()).toEqual(['Terminal']);
  });

  it('el mismo atajo abre la terminal del repositorio activo y Ctrl+W la cierra', async () => {
    const user = userEvent.setup();

    renderShell();

    await openRepo(user, '/home/example/projects/gitthul');

    await user.keyboard('{Control>}{Shift>}t{/Shift}{/Control}');
    expect(screen.getByRole('textbox', { name: 'Escribe un comando…' })).toBeInTheDocument();
    const tab = useShellStore
      .getState()
      .tabs.find((entry) => entry.id === useShellStore.getState().activeId);
    expect(tab?.context.cwd).toBe('/home/example/projects/gitthul');

    await user.keyboard('{Escape}');
    expect(screen.getByRole('textbox', { name: 'Escribe un comando…' })).toBeInTheDocument();
    await user.keyboard('{Control>}w{/Control}');
    expect(
      await screen.findByRole('region', { name: 'Referencias de gitthul' }),
    ).toBeInTheDocument();
  });

  it('el antiguo atajo de terminal contextual no abre otra pestaña', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.keyboard('{Alt>}t{/Alt}');

    expect(screen.getByRole('button', { name: 'Abrir «Acerca de GitThul»' })).toBeInTheDocument();
    expect(tabNames()).toEqual([]);
  });

  it('cierran la pestaña activa', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.keyboard('{Control>}{Shift>}t{/Shift}{/Control}');
    expect(tabNames()).toEqual(['Terminal']);

    await user.keyboard('{Control>}w{/Control}');
    expect(tabNames()).toEqual([]);
  });

  it('cambiar de tema conserva su botón y ya no requiere otro atajo', async () => {
    const user = userEvent.setup();

    renderShell();

    expect(screen.getByRole('button', { name: 'Cambiar al modo claro' })).toBeInTheDocument();

    await user.keyboard('{Alt>}m{/Alt}');
    expect(screen.getByRole('button', { name: 'Cambiar al modo claro' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cambiar al modo claro' }));

    expect(screen.getByRole('button', { name: 'Cambiar al modo oscuro' })).toBeInTheDocument();
    expect(document.documentElement.dataset['mode']).toBe('light');
  });

  it('Ctrl+F busca en la vista activa y no requiere otro combo en GitWorking', async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findAllByRole('option');
    await user.keyboard('{Control>}f{/Control}');
    expect(document.getElementById('repositories-filter')).toHaveFocus();
    await openRepo(user, '/home/example/projects/gitthul');
    await screen.findByRole('region', { name: 'Referencias de gitthul' });
    const before = useWorkingStore.getState().filterFocus;
    await user.keyboard('{Control>}f{/Control}');
    expect(useWorkingStore.getState().filterFocus).toBe(before + 1);
  });
});

describe('búsqueda global', () => {
  useVirtualViewport();

  it('lanza una acción del registro de gestos', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.keyboard('{Control>}p{/Control}');

    const palette = screen.getByRole('dialog', { name: 'Búsqueda global' });

    await user.type(within(palette).getByRole('combobox'), 'terminal');
    await user.click(
      await within(palette).findByRole('option', { name: /Abrir una pestaña de terminal/ }),
    );

    expect(tabNames()).toEqual(['Terminal']);
  });

  it.each(['list', 'spaces'] as const)(
    'abre un espacio desde búsqueda con diseño previo %s',
    async (layout) => {
      const user = userEvent.setup();
      const library = createMockLibraryPort();
      const created = await library.createSpace('Espacio aguja');
      const space = created.spaces[0]!;
      await library.addToSpace(space.id, 'gitthul');
      await library.setSpaceCollapsed(space.id, true);
      await library.setLayout(layout);
      renderShell('es-MX', undefined, { ...ports, library });
      await user.click(screen.getByRole('button', { name: 'Abrir Configuraciones' }));
      await user.keyboard('{Control>}p{/Control}');
      await user.type(screen.getByRole('combobox'), 'Espacio aguja');
      await user.click(screen.getByRole('button', { name: 'Todo GitThul' }));
      await user.click(await screen.findByRole('option', { name: /^Espacio aguja/ }));
      const zone = await screen.findByRole('region', { name: 'Espacio Espacio aguja' });
      expect(zone).toHaveAttribute('data-current');
      expect(
        within(zone).getByRole('listbox', { name: 'Repositorios de Espacio aguja' }),
      ).toBeInTheDocument();
      expect(useShellStore.getState().settingsOpen).toBe(false);
      expect(await library.read()).toMatchObject({
        layout: 'spaces',
        view: { kind: 'space', id: space.id },
        spaces: [expect.objectContaining({ id: space.id, repos: ['gitthul'] })],
      });
      expect((await library.read()).spaces[0]?.collapsed).not.toBe(true);
    },
  );

  it('abre el historial del archivo encontrado en la rama activa y permite elegir su versión', async () => {
    const user = userEvent.setup();
    const testPorts = {
      ...ports,
      git: createMockGitPort({ latency: NO_LATENCY }),
      library: createMockLibraryPort(),
    };
    const refs = await testPorts.git.readRefs('gitthul');
    const originalHistory = testPorts.git.readFileHistory.bind(testPorts.git);
    const readHistory = vi
      .spyOn(testPorts.git, 'readFileHistory')
      .mockImplementation(async (...args) =>
        (await originalHistory(...args)).filter((commit) => commit.sha !== refs.head.sha),
      );
    renderShell('es-MX', undefined, testPorts);
    await openRepo(user, '/home/example/projects/gitthul');
    act(() => useWorkingStore.setState({ detailsCollapsed: true }));
    await user.keyboard('{Control>}p{/Control}');
    // La búsqueda vive en un portal: esperar dentro de su diálogo evita
    // recorrer el grafo, los diffs y las referencias que siguen en el fondo.
    const search = within(screen.getByRole('dialog', { name: 'Búsqueda global' }));
    await user.type(search.getByRole('combobox'), 'docs/inventario.md');
    await user.click(
      await search.findByRole(
        'option',
        { name: /^docs\/inventario.md Archivos de la rama activa/ },
        { timeout: 3000 },
      ),
    );
    const history = await screen.findByRole('region', { name: 'Historial de docs/inventario.md' });
    const versions = await within(history).findAllByRole('listitem');
    expect(versions.length).toBeGreaterThan(1);
    expect(within(versions[0]!).getByRole('button')).toHaveAttribute('aria-current', 'true');
    expect(within(versions[1]!).getByRole('button')).not.toHaveAttribute('aria-current');
    expect(readHistory).toHaveBeenCalled();
    expect(readHistory.mock.calls.at(-1)?.slice(0, 2)).toEqual(['gitthul', 'docs/inventario.md']);
    expect(useWorkingStore.getState().detailsCollapsed).toBe(false);
    expect(await screen.findByRole('region', { name: 'Diff de docs/inventario.md' })).toBeVisible();
    expect(
      await within(
        screen.getByRole('region', { name: 'Diff de docs/inventario.md' }),
      ).findAllByRole('textbox'),
    ).not.toHaveLength(0);
    const newest = (await originalHistory('gitthul', 'docs/inventario.md')).find(
      (commit) => commit.sha !== refs.head.sha,
    )!;
    expect(useWorkingStore.getState().diff?.source).toEqual({ kind: 'commit', sha: newest.sha });
    expect(useWorkingStore.getState().fileHistory?.at).toBe(newest.sha);
    expect(useWorkingStore.getState().fileHistory?.openLatest).toBeUndefined();
    expect(useShellStore.getState().searchNavigation).toBeNull();
    await user.click(within(versions[1]!).getByRole('button'));
    await waitFor(() =>
      expect(within(versions[1]!).getByRole('button')).toHaveAttribute('aria-current', 'true'),
    );
    expect(within(versions[0]!).getByRole('button')).not.toHaveAttribute('aria-current');
    expect(await screen.findByRole('region', { name: 'Diff de docs/inventario.md' })).toBeVisible();
    expect(history).toBeVisible();
  });

  it('abre un stash encontrado y enfoca su SHA conservando la selección sintética', async () => {
    const user = userEvent.setup();
    renderShell();
    await openRepo(user, '/home/example/projects/gitthul');
    const refs = await ports.git.readRefs('gitthul');
    const stash = refs.stashes[0]!;
    await user.keyboard('{Control>}p{/Control}');
    await user.type(screen.getByRole('combobox'), 'paleta del tema Grimorio');
    const option = await within(screen.getByRole('dialog')).findByRole('option', {
      name: /WIP: paleta del tema Grimorio/,
    });
    await user.click(option);
    await waitFor(() =>
      expect(useWorkingStore.getState().selectedCommits).toEqual(new Set([`stash:${stash.index}`])),
    );
    expect(useWorkingStore.getState().goTo?.sha).toBe(stash.sha);
    expect(useShellStore.getState().searchNavigation).toBeNull();
  });

  it('cambia la sección de ajustes ya montada y enfoca el tamaño de fuente', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Abrir Configuraciones' }));
    await user.click(screen.getByRole('tab', { name: 'Idioma' }));
    await user.keyboard('{Control>}p{/Control}');
    await user.type(screen.getByRole('combobox'), 'tamaño de fuente');
    await user.click(await screen.findByRole('option', { name: /^Tamaño de fuente.*Apariencia/ }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Apariencia' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByRole('slider', { name: 'Tamaño de interfaz' })).toHaveFocus();
  });

  it('dice cuando nada coincide', async () => {
    const user = userEvent.setup();

    renderShell();
    await user.click(screen.getByRole('button', { name: 'Abrir Configuraciones' }));

    await user.keyboard('{Control>}p{/Control}');
    await user.type(screen.getByRole('combobox'), 'zzz');

    expect(await screen.findByText('Nada coincide con lo que escribiste')).toBeInTheDocument();
  });

  // Sin tildes: nadie escribe «configuración» con tilde en un buscador.
  it('encuentra sin importar tildes ni mayúsculas', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.keyboard('{Control>}p{/Control}');
    const search = within(screen.getByRole('dialog', { name: 'Búsqueda global' }));
    await user.type(search.getByRole('combobox'), 'CONFIGURACION');

    expect(
      await search.findByRole('option', { name: /Abrir Configuraciones/ }),
    ).toBeInTheDocument();
  });
});

describe('idioma', () => {
  useVirtualViewport();

  it('arranca en el idioma que se le dé y se cambia en caliente', async () => {
    const user = userEvent.setup();

    renderShell();

    // Abre la vista de configuraciones
    await user.click(screen.getByRole('button', { name: 'Abrir Configuraciones' }));

    // Navega a la sección de idioma
    await user.click(screen.getByRole('tab', { name: 'Idioma' }));

    // Cambia el idioma a inglés
    await user.click(screen.getByRole('radio', { name: /English/ }));

    // La interfaz entera se retraduce: la pestaña de idioma ahora dice "Language"
    expect(screen.getByRole('tab', { name: 'Language' })).toBeInTheDocument();

    // Vuelve al hogar haciendo clic en Repositorios
    await user.click(screen.getByRole('button', { name: 'Go to Repositories' }));

    // De vuelta en el hogar, la interfaz está en inglés
    expect(screen.getByRole('list', { name: 'Open tabs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open “About GitThul”' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
  });

  it('los atajos se pintan según la plataforma', async () => {
    const user = userEvent.setup();

    renderShell();

    await user.keyboard('{Control>}p{/Control}');

    expect(
      within(await screen.findByRole('option', { name: /Ir a Repositorios/ })).getByText(
        'Ctrl+Shift+H',
      ),
    ).toBeInTheDocument();
  });
});
