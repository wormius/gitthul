import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GestureProvider } from '@app/GestureProvider';
import { PortsContext } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { createMockLibraryPort } from '@core/adapters/mock/mockLibraryPort';
import { createMockSystemPort } from '@core/adapters/mock/mockSystemPort';
import { selectPorts, type AppPorts } from '@core/adapters/selectPorts';
import { GitOperationError } from '@core/domain/errors';
import { ThemeProvider } from '@design/ThemeProvider';
import { DEFAULT_USER_COLOR } from '@design/userColor';
import { I18nProvider } from '@i18n/I18nProvider';

import { useVirtualViewport } from '../../test/virtualViewport';
import { RepositoriesView } from './RepositoriesView';
import { useRepositoriesStore } from './repositoriesStore';

function makePorts(): AppPorts & {
  git: ReturnType<typeof createMockGitPort>;
  library: ReturnType<typeof createMockLibraryPort>;
  system: ReturnType<typeof createMockSystemPort>;
} {
  return {
    ...selectPorts(),
    git: createMockGitPort({ latency: NO_LATENCY }),
    library: createMockLibraryPort({ now: () => Date.UTC(2026, 7, 21) }),
    system: createMockSystemPort(),
  };
}

function renderView(ports: AppPorts) {
  return render(
    <PortsContext value={ports}>
      <ThemeProvider initialSettings={{ theme: 'thul', mode: 'dark' }}>
        <I18nProvider initialLocale="es-MX">
          <GestureProvider platform="linux">
            <RepositoriesView />
          </GestureProvider>
        </I18nProvider>
      </ThemeProvider>
    </PortsContext>,
  );
}

async function knownRows() {
  return within(
    await screen.findByRole('listbox', { name: 'Repositorios conocidos' }),
  ).getAllByRole('option');
}

function rowAt(rows: readonly HTMLElement[], path: string) {
  const row = rows.find((candidate) => within(candidate).queryByText(path));
  if (!row) throw new Error(`No existe la fila ${path}`);
  return row;
}

function clickRow(row: HTMLElement, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  const target = within(row).getByText(/\//);
  fireEvent.mouseDown(target, { button: 0, detail: 1, ...modifiers });
  fireEvent.click(target, { button: 0, detail: 1, ...modifiers });
}

function startRowDrag(row: HTMLElement) {
  const target = within(row).getByText(/\//);
  fireEvent.mouseDown(target, { button: 0, detail: 1 });
  fireEvent.dragStart(target);
}

function openedRepositoryIds() {
  return useShellStore
    .getState()
    .tabs.flatMap((tab) => (tab.surface.kind === 'working' ? [tab.surface.repoId] : []));
}

function expectContextOnlyBatchActions() {
  expect(screen.queryByRole('toolbar', { name: 'Selección de repositorios' })).toBeNull();
  expect(
    screen
      .queryAllByRole('button', { name: /^(?:Abrir|Olvidar) \d+ repositorios$/ })
      .filter((button) => !button.closest('[role="dialog"]')),
  ).toEqual([]);
}

beforeEach(() => {
  useRepositoriesStore.getState().reset();
  useShellStore.getState().reset();
});

describe('RepositoriesView con biblioteca real', () => {
  useVirtualViewport();

  it('carga Recientes y Todos y ofrece el reparto de Espacios', async () => {
    renderView(makePorts());
    expect(await knownRows()).toHaveLength(4);
    expect(screen.getByRole('region', { name: 'Recientes' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Espacios' })).toBeInTheDocument();
    expectContextOnlyBatchActions();
  });

  it('selecciona varios con Ctrl y los abre sin duplicar las pestañas existentes', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const markOpened = vi.spyOn(ports.git, 'markOpened');
    renderView(ports);
    const rows = await knownRows();
    const gitthul = rowAt(rows, '/home/example/projects/gitthul');
    const bitacora = rowAt(rows, '/home/example/projects/bitacora');

    clickRow(gitthul);
    clickRow(bitacora, { ctrlKey: true });
    expect(gitthul).toHaveAttribute('aria-selected', 'true');
    expect(bitacora).toHaveAttribute('aria-selected', 'true');
    expect(openedRepositoryIds()).toEqual([]);
    expectContextOnlyBatchActions();

    fireEvent.contextMenu(within(gitthul).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Abrir 2 repositorios' }));
    await waitFor(() => expect(openedRepositoryIds().sort()).toEqual(['bitacora', 'gitthul']));
    await waitFor(() => expect(markOpened).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useRepositoriesStore.getState().batchBusy).toBe(false));
    fireEvent.contextMenu(within(bitacora).getByText('/home/example/projects/bitacora'));
    await user.click(await screen.findByRole('menuitem', { name: 'Abrir 2 repositorios' }));
    await waitFor(() => expect(markOpened).toHaveBeenCalledTimes(4));
    expect(openedRepositoryIds().sort()).toEqual(['bitacora', 'gitthul']);
  });

  it('extiende rangos con Mayús, selecciona todo con Ctrl+A y reemplaza con un clic normal', async () => {
    renderView(makePorts());
    const rows = await knownRows();
    const all = screen.getByRole('listbox', { name: 'Repositorios conocidos' });
    expect(all).toHaveAttribute('aria-multiselectable', 'true');

    clickRow(rows[0]!);
    clickRow(rows[2]!, { shiftKey: true });
    expect(within(all).getAllByRole('option', { selected: true })).toHaveLength(3);
    fireEvent.keyDown(all, { key: 'a', ctrlKey: true });
    expect(within(all).getAllByRole('option', { selected: true })).toHaveLength(4);
    clickRow(rows[3]!);
    expect(within(all).getAllByRole('option', { selected: true })).toEqual([rows[3]]);
    expect(openedRepositoryIds()).toEqual([]);
  });

  it('abre las acciones del lote con el menú contextual del teclado', async () => {
    renderView(makePorts());
    const rows = await knownRows();
    clickRow(rows[0]!);
    clickRow(rows[1]!, { ctrlKey: true });
    const list = screen.getByRole('listbox', { name: 'Repositorios conocidos' });
    list.focus();

    fireEvent.keyDown(list, { key: 'F10', shiftKey: true });
    expect(await screen.findByRole('menuitem', { name: /Abrir 2 repositorios/ })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: /Olvidar 2 repositorios/ })).toBeEnabled();
    expect(within(list).getAllByRole('option', { selected: true })).toHaveLength(2);
  });

  it('el menú de un miembro conserva el lote y el de otro repositorio lo reemplaza', async () => {
    const user = userEvent.setup();
    renderView(makePorts());
    const rows = await knownRows();
    const gitthul = rowAt(rows, '/home/example/projects/gitthul');
    const bitacora = rowAt(rows, '/home/example/projects/bitacora');
    const dotfiles = rowAt(rows, '/home/example/dotfiles');
    clickRow(gitthul);
    clickRow(bitacora, { ctrlKey: true });

    fireEvent.contextMenu(within(gitthul).getByText('/home/example/projects/gitthul'));
    expect(await screen.findByRole('menuitem', { name: 'Abrir 2 repositorios' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Olvidar 2 repositorios' })).toBeVisible();
    expect(bitacora).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');

    fireEvent.contextMenu(within(dotfiles).getByText('/home/example/dotfiles'));
    expect(await screen.findByRole('menuitem', { name: 'Abrir' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Abrir 2 repositorios' })).toBeNull();
    expect(dotfiles).toHaveAttribute('aria-selected', 'true');
    expect(gitthul).toHaveAttribute('aria-selected', 'false');
    expect(bitacora).toHaveAttribute('aria-selected', 'false');
  });

  it('comparte la selección entre Recientes y Todos sin contar dos veces el mismo repositorio', async () => {
    const user = userEvent.setup();
    renderView(makePorts());
    const rows = await knownRows();
    const allGitthul = rowAt(rows, '/home/example/projects/gitthul');
    const recent = within(screen.getByRole('region', { name: 'Recientes' })).getByRole('listbox');
    const recentRows = within(recent).getAllByRole('option');
    const recentGitthul = rowAt(recentRows, '/home/example/projects/gitthul');
    const recentBitacora = rowAt(recentRows, '/home/example/projects/bitacora');

    clickRow(allGitthul);
    clickRow(recentBitacora, { ctrlKey: true });
    fireEvent.contextMenu(within(recentGitthul).getByText('/home/example/projects/gitthul'));
    expect(await screen.findByRole('menuitem', { name: 'Abrir 2 repositorios' })).toBeVisible();
    expectContextOnlyBatchActions();
    expect(recentGitthul).toHaveAttribute('aria-selected', 'true');
    expect(rowAt(rows, '/home/example/projects/bitacora')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');

    clickRow(recentGitthul, { ctrlKey: true });
    expect(allGitthul).toHaveAttribute('aria-selected', 'false');
    expect(recentGitthul).toHaveAttribute('aria-selected', 'false');
    expect(useRepositoriesStore.getState().selected?.id).toBe('bitacora');
    expect(openedRepositoryIds()).toEqual([]);
  });

  it('el filtro retira de la selección los repositorios que ya no están visibles', async () => {
    const user = userEvent.setup();
    renderView(makePorts());
    const rows = await knownRows();
    clickRow(rowAt(rows, '/home/example/projects/gitthul'));
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });
    await user.type(
      screen.getByLabelText('Filtrar los repositorios por nombre o por ruta'),
      'bitacora',
    );

    await waitFor(() => expect(useRepositoriesStore.getState().selected?.id).toBe('bitacora'));
    const filteredRows = await knownRows();
    expect(filteredRows).toHaveLength(1);
    await user.pointer({
      keys: '[MouseRight]',
      target: within(filteredRows[0]!).getByText('/home/example/projects/bitacora'),
    });
    expect(await screen.findByRole('menuitem', { name: 'Abrir' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Abrir 2 repositorios' })).toBeNull();
    expectContextOnlyBatchActions();
    await user.keyboard('{Escape}');
    await user.clear(screen.getByLabelText('Filtrar los repositorios por nombre o por ruta'));
    expect(rowAt(await knownRows(), '/home/example/projects/gitthul')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('olvidar varios confirma nombres y rutas, permite cancelar y conserva los no seleccionados', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const forget = vi.spyOn(ports.git, 'forgetRepository');
    await ports.library.createSpace('Trabajo');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'bitacora');
    await ports.library.addToSpace('space-1', 'dotfiles');
    renderView(ports);
    const rows = await knownRows();
    const gitthul = rowAt(rows, '/home/example/projects/gitthul');
    clickRow(gitthul);
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });

    fireEvent.contextMenu(within(gitthul).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Olvidar 2 repositorios' }));
    let dialog = await screen.findByRole('dialog', { name: 'Olvidar 2 repositorios' });
    expectContextOnlyBatchActions();
    const targets = within(dialog).getByRole('list', { name: 'Repositorios que se van a olvidar' });
    expect(within(targets).getByText('gitthul')).toBeVisible();
    expect(within(targets).getByText('/home/example/projects/gitthul')).toBeVisible();
    expect(within(targets).getByText('bitacora')).toBeVisible();
    expect(within(targets).getByText('/home/example/projects/bitacora')).toBeVisible();
    expect(
      within(dialog).getByText(/Sus carpetas y su historial Git se conservarán/),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Conservar 2 repositorios' }));
    expect(forget).not.toHaveBeenCalled();
    expect(await ports.git.listRepositories()).toHaveLength(4);

    fireEvent.contextMenu(within(gitthul).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Olvidar 2 repositorios' }));
    dialog = await screen.findByRole('dialog', { name: 'Olvidar 2 repositorios' });
    await user.click(within(dialog).getByRole('button', { name: 'Olvidar 2 repositorios' }));
    await waitFor(() => expect(forget).toHaveBeenCalledTimes(2));
    expect(forget.mock.calls.map(([id]) => id).sort()).toEqual(['bitacora', 'gitthul']);
    await waitFor(() =>
      expect(
        useRepositoriesStore
          .getState()
          .repositories?.map((repo) => repo.id)
          .sort(),
      ).toEqual(['dotfiles', 'gitthul-worktree']),
    );
    expect((await ports.library.read()).spaces[0]?.repos).toContain('dotfiles');
  });

  it('selecciona tarjetas entre espacios y cuenta una sola vez las membresías repetidas', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Uno');
    await ports.library.createSpace('Dos');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'bitacora');
    await ports.library.addToSpace('space-2', 'gitthul');
    await ports.library.addToSpace('space-2', 'dotfiles');
    await ports.library.setLayout('spaces');
    renderView(ports);
    await knownRows();
    const first = within(await screen.findByRole('listbox', { name: 'Repositorios de Uno' }));
    const second = within(screen.getByRole('listbox', { name: 'Repositorios de Dos' }));
    const gitthulFirst = rowAt(first.getAllByRole('option'), '/home/example/projects/gitthul');
    const gitthulSecond = rowAt(second.getAllByRole('option'), '/home/example/projects/gitthul');
    const bitacora = rowAt(first.getAllByRole('option'), '/home/example/projects/bitacora');
    const dotfiles = rowAt(second.getAllByRole('option'), '/home/example/dotfiles');

    clickRow(gitthulFirst);
    clickRow(bitacora, { ctrlKey: true });
    expect(gitthulSecond).toHaveAttribute('aria-selected', 'true');
    fireEvent.contextMenu(within(gitthulSecond).getByText('/home/example/projects/gitthul'));
    expect(await screen.findByRole('menuitem', { name: 'Abrir 2 repositorios' })).toBeVisible();
    expectContextOnlyBatchActions();
    await user.keyboard('{Escape}');
    clickRow(gitthulSecond, { ctrlKey: true });
    expect(gitthulFirst).toHaveAttribute('aria-selected', 'false');
    expect(gitthulSecond).toHaveAttribute('aria-selected', 'false');
    expect(useRepositoriesStore.getState().selected?.id).toBe('bitacora');

    clickRow(gitthulFirst);
    clickRow(dotfiles, { shiftKey: true });
    fireEvent.contextMenu(within(dotfiles).getByText('/home/example/dotfiles'));
    expect(await screen.findByRole('menuitem', { name: 'Abrir 3 repositorios' })).toBeVisible();
    expectContextOnlyBatchActions();
    expect(bitacora).toHaveAttribute('aria-selected', 'true');
    expect(dotfiles).toHaveAttribute('aria-selected', 'true');
    expect(openedRepositoryIds()).toEqual([]);
  });

  it('persiste el layout y monta miembros vivos como tarjetas seleccionables', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Alex');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'repo-que-ya-no-existe');
    renderView(ports);
    await knownRows();

    await user.click(screen.getByRole('radio', { name: 'Espacios' }));
    await waitFor(async () => expect((await ports.library.read()).layout).toBe('spaces'));
    const zone = await screen.findByRole('listbox', { name: 'Repositorios de Alex' });
    expect(within(zone).getAllByRole('option')).toHaveLength(1);

    const card = within(zone).getByRole('option');
    await user.click(card);
    expect(useRepositoriesStore.getState().selected?.id).toBe('gitthul');
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:space-1');

    await user.click(screen.getByRole('button', { name: 'Plegar Alex' }));
    await waitFor(async () => expect((await ports.library.read()).spaces[0]?.collapsed).toBe(true));
    expect(screen.queryByRole('listbox', { name: 'Repositorios de Alex' })).not.toBeInTheDocument();
  });

  it('las flechas recorren las tarjetas visibles y omiten espacios plegados', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Plegado');
    await ports.library.createSpace('Uno');
    await ports.library.createSpace('Dos');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-2', 'bitacora');
    await ports.library.addToSpace('space-3', 'dotfiles');
    await ports.library.setSpaceCollapsed('space-1', true);
    await ports.library.setLayout('spaces');
    renderView(ports);
    await knownRows();

    const spaces = await screen.findByRole('group', { name: 'Espacios' });
    const visible = within(spaces).getAllByRole('option');

    visible[0]?.focus();
    fireEvent.keyDown(visible[0]!, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(visible[1]);
  });

  it('invierte layout y orden también al pulsar la opción que ya está activa', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    renderView(ports);
    await knownRows();

    await user.click(screen.getByRole('radio', { name: 'Lista' }));
    await waitFor(async () => expect((await ports.library.read()).layout).toBe('spaces'));
    await user.click(screen.getByRole('radio', { name: 'Espacios' }));
    await waitFor(async () => expect((await ports.library.read()).layout).toBe('list'));

    await user.click(screen.getByRole('radio', { name: 'Por última apertura' }));
    await waitFor(async () => expect((await ports.library.read()).sort).toBe('name'));
    await user.click(screen.getByRole('radio', { name: 'Por nombre' }));
    await waitFor(async () => expect((await ports.library.read()).sort).toBe('lastOpened'));
  });

  it('elegir el avatar de una card seleccionada no abre GitWorking', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Trabajo');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.setLayout('spaces');
    renderView(ports);
    await knownRows();

    const zone = await screen.findByRole('listbox', { name: 'Repositorios de Trabajo' });
    const card = within(zone).getByRole('option');
    await user.click(card);
    fireEvent.contextMenu(within(card).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Elegir avatar' }));

    expect(await screen.findByRole('dialog', { name: 'Avatar de gitthul' })).toBeVisible();
    expect(useShellStore.getState().tabs).toHaveLength(0);
    expect(useShellStore.getState().activeId).toBeNull();
  });

  it('ofrece primero los colores y persiste un color personalizado del avatar', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    renderView(ports);
    const row = rowAt(await knownRows(), '/home/example/projects/gitthul');

    fireEvent.contextMenu(within(row).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Elegir avatar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Avatar de gitthul' });
    const custom = within(dialog).getByLabelText('Color personalizado');
    const rocket = within(dialog).getByRole('button', { name: 'Cohete' });
    const chosenColor = DEFAULT_USER_COLOR.replaceAll('8', '7');
    expect(custom.compareDocumentPosition(rocket) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    fireEvent.change(custom, { target: { value: chosenColor } });
    await user.click(rocket);
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(async () =>
      expect((await ports.library.read()).avatars['gitthul']).toEqual({
        glyph: 'rocket',
        tone: 1,
        color: chosenColor,
      }),
    );
  });

  it('crea, renombra y elimina espacios sin olvidar repositorios', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.setLayout('spaces');
    renderView(ports);
    await knownRows();

    await user.click(screen.getByRole('button', { name: '+ Crear un espacio' }));
    const create = await screen.findByRole('dialog', { name: 'Crear un espacio' });
    await user.type(within(create).getByLabelText('Nombre del espacio'), 'Trabajo');
    await user.click(within(create).getByRole('button', { name: 'Crear espacio' }));
    await screen.findByRole('region', { name: 'Espacio Trabajo' });
    expect((await ports.library.read()).spaces.map((space) => space.name)).toEqual(['Trabajo']);

    await user.keyboard('{F2}');
    expect(screen.queryByRole('textbox', { name: 'Renombrar Trabajo' })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('region', { name: 'Espacio Trabajo' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Renombrar Trabajo' }));
    const rename = await screen.findByRole('textbox', { name: 'Renombrar Trabajo' });
    await user.clear(rename);
    await user.type(rename, 'Cliente{Enter}');
    await screen.findByRole('region', { name: 'Espacio Cliente' });

    await user.keyboard('{Alt>}{Delete}{/Alt}');
    expect(screen.queryByRole('dialog', { name: 'Eliminar Cliente' })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('region', { name: 'Espacio Cliente' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Eliminar Cliente' }));
    const remove = await screen.findByRole('dialog', { name: 'Eliminar Cliente' });
    expect(within(remove).getByText(/No se olvidará ningún repositorio/)).toBeInTheDocument();
    await user.click(within(remove).getByRole('button', { name: 'Eliminar espacio' }));
    await waitFor(async () => expect((await ports.library.read()).spaces).toHaveLength(0));
    expect(await ports.git.listRepositories()).toHaveLength(4);
  });

  it('mueve a un espacio desde un submenú de nombres y deshabilita los actuales', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Trabajo');
    await ports.library.createSpace('Cliente');
    await ports.library.addToSpace('space-1', 'gitthul');
    renderView(ports);
    const row = rowAt(await knownRows(), '/home/example/projects/gitthul');

    fireEvent.contextMenu(within(row).getByText('/home/example/projects/gitthul'));
    expect(await screen.findByRole('menuitem', { name: 'Abrir' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Abrir la carpeta\b/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Buscar .* en otra carpeta/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Elegir avatar' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Olvidar en GitThul\b/ })).toBeInTheDocument();

    await user.hover(screen.getByRole('menuitem', { name: 'Mover a espacio' }));
    expect(await screen.findByRole('menuitem', { name: 'Trabajo' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'Cliente' }));
    await waitFor(async () =>
      expect((await ports.library.read()).spaces[1]?.repos).toContain('gitthul'),
    );
  });

  it('quita la tarjeta de su espacio exacto aunque la biblioteca señale otro', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Uno');
    await ports.library.createSpace('Dos');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'bitacora');
    await ports.library.addToSpace('space-2', 'gitthul');
    await ports.library.setLayout('spaces');
    await ports.library.setView({ kind: 'space', id: 'space-2' });
    const forget = vi.spyOn(ports.git, 'forgetRepository');
    renderView(ports);
    await knownRows();
    const first = within(await screen.findByRole('listbox', { name: 'Repositorios de Uno' }));
    const card = rowAt(first.getAllByRole('option'), '/home/example/projects/gitthul');

    fireEvent.contextMenu(within(card).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Abrir' }));
    await waitFor(() => expect(openedRepositoryIds()).toEqual(['gitthul']));
    fireEvent.contextMenu(within(card).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar de Uno' }));

    await waitFor(async () => {
      const library = await ports.library.read();
      expect(library.spaces[0]?.repos).toEqual(['bitacora']);
      expect(library.spaces[1]?.repos).toEqual(['gitthul']);
      expect(library.view).toEqual({ kind: 'space', id: 'space-2' });
    });
    await waitFor(() =>
      expect(screen.getByRole('listbox', { name: 'Repositorios conocidos' })).toHaveFocus(),
    );
    expect(await knownRows()).toHaveLength(4);
    expect(useRepositoriesStore.getState().selected?.id).toBe('gitthul');
    expect(openedRepositoryIds()).toEqual(['gitthul']);
    expect(forget).not.toHaveBeenCalled();
  });

  it('quita el lote de un espacio contando solo sus miembros y conserva las demás selecciones', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Uno');
    await ports.library.createSpace('Dos');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'bitacora');
    await ports.library.addToSpace('space-2', 'gitthul');
    await ports.library.setLayout('spaces');
    renderView(ports);
    const rows = await knownRows();
    const first = within(await screen.findByRole('listbox', { name: 'Repositorios de Uno' }));
    const second = within(screen.getByRole('listbox', { name: 'Repositorios de Dos' }));
    clickRow(rowAt(second.getAllByRole('option'), '/home/example/projects/gitthul'));
    clickRow(rowAt(first.getAllByRole('option'), '/home/example/projects/bitacora'), {
      ctrlKey: true,
    });
    clickRow(rowAt(rows, '/home/example/dotfiles'), { ctrlKey: true });
    const card = rowAt(first.getAllByRole('option'), '/home/example/projects/gitthul');
    fireEvent.contextMenu(within(card).getByText('/home/example/projects/gitthul'));

    expect(
      await screen.findByRole('menuitem', { name: 'Quitar 2 repositorios de Uno' }),
    ).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: /todos los espacios/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Quitar 3 repositorios/ })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Quitar 2 repositorios de Uno' }));

    await waitFor(async () => {
      const spaces = (await ports.library.read()).spaces;
      expect(spaces[0]?.repos).toEqual([]);
      expect(spaces[1]?.repos).toEqual(['gitthul']);
    });
    await waitFor(() =>
      expect(screen.getByRole('listbox', { name: 'Repositorios conocidos' })).toHaveFocus(),
    );
    expect(
      within(screen.getByRole('listbox', { name: 'Repositorios conocidos' })).getAllByRole(
        'option',
        { selected: true },
      ),
    ).toHaveLength(3);
    expect(await knownRows()).toHaveLength(4);
    expect(openedRepositoryIds()).toEqual([]);
  });

  it('el menú de teclado de Lista ofrece el submenú para quitar de cada espacio', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Uno');
    await ports.library.createSpace('Dos');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'bitacora');
    await ports.library.addToSpace('space-2', 'gitthul');
    renderView(ports);
    const rows = await knownRows();
    clickRow(rowAt(rows, '/home/example/projects/gitthul'));
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });
    const list = screen.getByRole('listbox', { name: 'Repositorios conocidos' });
    list.focus();
    fireEvent.keyDown(list, { key: 'F10', shiftKey: true });

    expect(await screen.findByRole('menuitem', { name: 'Quitar de un espacio' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: /todos los espacios/ })).toBeNull();
    await user.hover(await screen.findByRole('menuitem', { name: 'Quitar de un espacio' }));
    expect(
      await screen.findByRole('menuitem', { name: 'Quitar 2 repositorios de Uno' }),
    ).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Quitar gitthul de Dos' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: 'Quitar 2 repositorios de Uno' }));

    await waitFor(async () => {
      const spaces = (await ports.library.read()).spaces;
      expect(spaces[0]?.repos).toEqual([]);
      expect(spaces[1]?.repos).toEqual(['gitthul']);
    });
    await waitFor(() => expect(list).toHaveFocus());
    expect(within(list).getAllByRole('option', { selected: true })).toHaveLength(2);
  });

  it('quita de cada espacio por separado y conserva el catálogo, las pestañas y el arrastre', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Uno');
    await ports.library.createSpace('Dos');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'bitacora');
    await ports.library.addToSpace('space-2', 'gitthul');
    await ports.library.addToSpace('space-2', 'dotfiles');
    const forget = vi.spyOn(ports.git, 'forgetRepository');
    renderView(ports);
    const rows = await knownRows();
    const gitthul = rowAt(rows, '/home/example/projects/gitthul');
    fireEvent.contextMenu(within(gitthul).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Abrir' }));
    await waitFor(() => expect(openedRepositoryIds()).toEqual(['gitthul']));
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });
    fireEvent.contextMenu(within(gitthul).getByText('/home/example/projects/gitthul'));
    await user.hover(await screen.findByRole('menuitem', { name: 'Quitar de un espacio' }));
    expect(screen.queryByRole('menuitem', { name: /todos los espacios/ })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar 2 repositorios de Uno' }));

    await waitFor(async () => {
      const spaces = (await ports.library.read()).spaces;
      expect(spaces[0]?.repos).toEqual([]);
      expect(spaces[1]?.repos).toEqual(['gitthul', 'dotfiles']);
    });
    await waitFor(() =>
      expect(screen.getByRole('listbox', { name: 'Repositorios conocidos' })).toHaveFocus(),
    );
    fireEvent.contextMenu(within(gitthul).getByText('/home/example/projects/gitthul'));
    await user.hover(await screen.findByRole('menuitem', { name: 'Quitar de un espacio' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar gitthul de Dos' }));

    await waitFor(async () => {
      const spaces = (await ports.library.read()).spaces;
      expect(spaces[0]?.repos).toEqual([]);
      expect(spaces[1]?.repos).toEqual(['dotfiles']);
    });
    await waitFor(() =>
      expect(screen.getByRole('listbox', { name: 'Repositorios conocidos' })).toHaveFocus(),
    );
    expect(await knownRows()).toHaveLength(4);
    expect(await ports.git.listRepositories()).toHaveLength(4);
    expect(openedRepositoryIds()).toEqual(['gitthul']);
    expect(forget).not.toHaveBeenCalled();
    fireEvent.contextMenu(within(gitthul).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Abrir 2 repositorios' }));
    await waitFor(() => expect(openedRepositoryIds().sort()).toEqual(['bitacora', 'gitthul']));
    await waitFor(() => expect(useRepositoriesStore.getState().batchBusy).toBe(false));

    startRowDrag(gitthul);
    const destinations = await screen.findByRole('group', { name: 'Soltar sobre un espacio' });
    const target = within(destinations).getByText('Uno').parentElement!;
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    await waitFor(async () => {
      const spaces = (await ports.library.read()).spaces;
      expect(spaces[0]?.repos).toEqual(['gitthul', 'bitacora']);
      expect(spaces[1]?.repos).toEqual(['dotfiles']);
    });
    expect(openedRepositoryIds().sort()).toEqual(['bitacora', 'gitthul']);
    expect(forget).not.toHaveBeenCalled();
  });

  it('omite quitar de espacios para una selección sin membresías', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Uno');
    await ports.library.addToSpace('space-1', 'gitthul');
    renderView(ports);
    const rows = await knownRows();
    const dotfiles = rowAt(rows, '/home/example/dotfiles');
    fireEvent.contextMenu(within(dotfiles).getByText('/home/example/dotfiles'));
    expect(await screen.findByRole('menuitem', { name: 'Abrir' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: /^Quitar/ })).toBeNull();
    await user.keyboard('{Escape}');
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });
    fireEvent.contextMenu(within(dotfiles).getByText('/home/example/dotfiles'));
    expect(await screen.findByRole('menuitem', { name: 'Abrir 2 repositorios' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: /^Quitar/ })).toBeNull();
  });

  it('un fallo al quitar el lote conserva sus membresías y muestra el error sin anunciar éxito', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Uno');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'bitacora');
    const error = new GitOperationError('unknown', {}, { output: 'Fixture library write failed' });
    const remove = vi.spyOn(ports.library, 'removeManyFromSpaces').mockRejectedValueOnce(error);
    renderView(ports);
    const rows = await knownRows();
    const gitthul = rowAt(rows, '/home/example/projects/gitthul');
    clickRow(gitthul);
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });
    fireEvent.contextMenu(within(gitthul).getByText('/home/example/projects/gitthul'));
    await user.hover(await screen.findByRole('menuitem', { name: 'Quitar de un espacio' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Quitar 2 repositorios de Uno' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'La operación de Git falló' })).toBeVisible();
    await waitFor(() => expect(useRepositoriesStore.getState().batchBusy).toBe(false));
    expect(remove).toHaveBeenCalledExactlyOnceWith(['gitthul', 'bitacora'], ['space-1']);
    expect((await ports.library.read()).spaces[0]?.repos).toEqual(['gitthul', 'bitacora']);
    expect(useShellStore.getState().status?.tone).toBe('warning');
    expect(
      within(screen.getByRole('listbox', { name: 'Repositorios conocidos' })).getAllByRole(
        'option',
        { selected: true },
      ),
    ).toHaveLength(2);
    expect(await knownRows()).toHaveLength(4);
  });

  it('distingue arrastrar una tarjeta de reordenar su zona', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Origen');
    await ports.library.createSpace('Destino');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.setLayout('spaces');
    renderView(ports);
    await knownRows();

    const origin = await screen.findByRole('region', { name: 'Espacio Origen' });
    const target = screen.getByRole('region', { name: 'Espacio Destino' });
    const card = within(origin).getByRole('option');
    fireEvent.dragStart(card);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    await waitFor(async () => {
      const spaces = (await ports.library.read()).spaces;
      expect(spaces[0]?.repos).not.toContain('gitthul');
      expect(spaces[1]?.repos).toContain('gitthul');
    });

    fireEvent.dragStart(target);
    fireEvent.dragOver(origin);
    fireEvent.drop(origin);
    await waitFor(async () =>
      expect((await ports.library.read()).spaces.map((space) => space.name)).toEqual([
        'Destino',
        'Origen',
      ]),
    );
  });

  it('agrega desde Todos al arrastrar sin quitar otras membresías', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Trabajo');
    await ports.library.setLayout('spaces');
    renderView(ports);
    const row = rowAt(await knownRows(), '/home/example/projects/gitthul');
    const target = await screen.findByRole('region', { name: 'Espacio Trabajo' });

    fireEvent.dragStart(within(row).getByText('/home/example/projects/gitthul'));
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    await waitFor(async () =>
      expect((await ports.library.read()).spaces[0]?.repos).toContain('gitthul'),
    );
  });

  it('arrastra la selección de Lista a un destino parcial y la guarda de una sola vez', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Origen');
    await ports.library.createSpace('Destino');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'bitacora');
    await ports.library.addToSpace('space-2', 'gitthul');
    const addMany = vi.spyOn(ports.library, 'addManyToSpace');
    renderView(ports);
    const rows = await knownRows();
    const gitthul = rowAt(rows, '/home/example/projects/gitthul');
    clickRow(gitthul);
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });

    startRowDrag(gitthul);
    const destinations = await screen.findByRole('group', { name: 'Soltar sobre un espacio' });
    const target = within(destinations).getByText('Destino').parentElement!;
    expect(target).toHaveAttribute('aria-disabled', 'false');
    expect(within(destinations).getByText('Origen').parentElement).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(async () => {
      const library = await ports.library.read();
      expect(library.spaces[0]?.repos).toEqual(['gitthul', 'bitacora']);
      expect(library.spaces[1]?.repos).toEqual(['gitthul', 'bitacora']);
      expect(library.layout).toBe('spaces');
      expect(library.view).toEqual({ kind: 'space', id: 'space-2' });
    });
    expect(addMany).toHaveBeenCalledTimes(1);
    expect(addMany).toHaveBeenCalledWith('space-2', ['gitthul', 'bitacora'], true);
    expect(openedRepositoryIds()).toEqual([]);
    expectContextOnlyBatchActions();
  });

  it('mantiene el lote que inició el arrastre aunque cambie después la selección', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Destino');
    renderView(ports);
    const rows = await knownRows();
    const gitthul = rowAt(rows, '/home/example/projects/gitthul');
    clickRow(gitthul);
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });
    startRowDrag(gitthul);
    clickRow(rowAt(rows, '/home/example/dotfiles'));
    expect(useRepositoriesStore.getState().selected?.id).toBe('dotfiles');

    const destinations = await screen.findByRole('group', { name: 'Soltar sobre un espacio' });
    const target = within(destinations).getByText('Destino').parentElement!;
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(async () =>
      expect((await ports.library.read()).spaces[0]?.repos).toEqual(['gitthul', 'bitacora']),
    );
    expect(openedRepositoryIds()).toEqual([]);
  });

  it('arrastra solamente la fila ajena al lote que se tomó como origen', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Destino');
    renderView(ports);
    const rows = await knownRows();
    clickRow(rowAt(rows, '/home/example/projects/gitthul'));
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });
    startRowDrag(rowAt(rows, '/home/example/dotfiles'));

    const destinations = await screen.findByRole('group', { name: 'Soltar sobre un espacio' });
    const target = within(destinations).getByText('Destino').parentElement!;
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(async () =>
      expect((await ports.library.read()).spaces[0]?.repos).toEqual(['dotfiles']),
    );
    expect(useRepositoriesStore.getState().selected?.id).toBe('dotfiles');
    expect(openedRepositoryIds()).toEqual([]);
  });

  it('arrastra tarjetas de varios espacios sin duplicar repositorios ni quitar sus membresías', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Uno');
    await ports.library.createSpace('Dos');
    await ports.library.createSpace('Destino');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-2', 'gitthul');
    await ports.library.addToSpace('space-2', 'bitacora');
    await ports.library.setLayout('spaces');
    renderView(ports);
    await knownRows();
    const first = within(await screen.findByRole('listbox', { name: 'Repositorios de Uno' }));
    const second = within(screen.getByRole('listbox', { name: 'Repositorios de Dos' }));
    clickRow(rowAt(first.getAllByRole('option'), '/home/example/projects/gitthul'));
    clickRow(rowAt(second.getAllByRole('option'), '/home/example/projects/bitacora'), {
      ctrlKey: true,
    });
    startRowDrag(rowAt(second.getAllByRole('option'), '/home/example/projects/gitthul'));
    const target = screen.getByRole('region', { name: 'Espacio Destino' });
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(async () => {
      const spaces = (await ports.library.read()).spaces;
      expect(spaces[0]?.repos).toEqual(['gitthul']);
      expect(spaces[1]?.repos).toEqual(['gitthul', 'bitacora']);
      expect(spaces[2]?.repos).toEqual(['gitthul', 'bitacora']);
    });
    expect(openedRepositoryIds()).toEqual([]);
  });

  it('crear un espacio desde el lote permite cancelar y después agregar todos los arrastrados', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Origen');
    await ports.library.addToSpace('space-1', 'gitthul');
    await ports.library.addToSpace('space-1', 'bitacora');
    const create = vi.spyOn(ports.library, 'createSpaceAndAddMany');
    renderView(ports);
    const rows = await knownRows();
    const gitthul = rowAt(rows, '/home/example/projects/gitthul');
    clickRow(gitthul);
    clickRow(rowAt(rows, '/home/example/projects/bitacora'), { ctrlKey: true });

    const dropOnCreate = async () => {
      startRowDrag(gitthul);
      const destinations = await screen.findByRole('group', { name: 'Soltar sobre un espacio' });
      const target = within(destinations).getByText('Nuevo espacio').parentElement!;
      fireEvent.dragOver(target);
      fireEvent.drop(target);
      return screen.findByRole('dialog', { name: 'Crear un espacio' });
    };
    let dialog = await dropOnCreate();
    await user.type(within(dialog).getByLabelText('Nombre del espacio'), 'Descartado');
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(create).not.toHaveBeenCalled();
    expect((await ports.library.read()).spaces).toHaveLength(1);

    dialog = await dropOnCreate();
    await user.type(within(dialog).getByLabelText('Nombre del espacio'), 'Cliente');
    await user.click(within(dialog).getByRole('button', { name: 'Crear espacio' }));
    await waitFor(async () => {
      const library = await ports.library.read();
      expect(library.spaces.map((space) => space.name)).toEqual(['Origen', 'Cliente']);
      expect(library.spaces[0]?.repos).toEqual(['gitthul', 'bitacora']);
      expect(library.spaces[1]?.repos).toEqual(['gitthul', 'bitacora']);
      expect(library.layout).toBe('spaces');
      expect(library.view).toEqual({ kind: 'space', id: 'space-2' });
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith('Cliente', ['gitthul', 'bitacora']);
    expect(openedRepositoryIds()).toEqual([]);
    expectContextOnlyBatchActions();
  });

  it('crea un espacio con el repositorio al soltar sobre el destino contextual', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Trabajo');
    await ports.library.addToSpace('space-1', 'gitthul');
    renderView(ports);
    const row = rowAt(await knownRows(), '/home/example/projects/gitthul');

    fireEvent.dragStart(within(row).getByText('/home/example/projects/gitthul'));
    const targets = await screen.findByRole('group', { name: 'Soltar sobre un espacio' });
    expect(
      targets.compareDocumentPosition(screen.getByRole('region', { name: 'Recientes' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(within(targets).getByText('Trabajo').parentElement).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.dragOver(within(targets).getByText('Nuevo espacio').parentElement!);
    fireEvent.drop(within(targets).getByText('Nuevo espacio').parentElement!);

    const dialog = await screen.findByRole('dialog', { name: 'Crear un espacio' });
    await user.type(within(dialog).getByLabelText('Nombre del espacio'), 'Cliente');
    await user.click(within(dialog).getByRole('button', { name: 'Crear espacio' }));
    await waitFor(async () => {
      const library = await ports.library.read();
      expect(library.layout).toBe('spaces');
      expect(library.view).toEqual({ kind: 'space', id: 'space-2' });
      expect(library.spaces[1]?.repos).toContain('gitthul');
    });
    expect(await screen.findByRole('region', { name: 'Espacio Cliente' })).toBeInTheDocument();
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:space-2');
  });

  it('al soltar desde Lista revela el espacio y conserva seleccionado el repositorio', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Trabajo');
    renderView(ports);
    const row = rowAt(await knownRows(), '/home/example/projects/gitthul');

    fireEvent.dragStart(within(row).getByText('/home/example/projects/gitthul'));
    const targets = await screen.findByRole('group', { name: 'Soltar sobre un espacio' });
    const target = within(targets).getByText('Trabajo').parentElement!;
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(async () => {
      const library = await ports.library.read();
      expect(library.layout).toBe('spaces');
      expect(library.view).toEqual({ kind: 'space', id: 'space-1' });
    });
    expect(useRepositoriesStore.getState().selected?.id).toBe('gitthul');
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:space-1');
  });

  it('abre todos los repositorios de un espacio sin duplicar pestañas', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const repos = await ports.git.listRepositories();
    await ports.library.createSpace('Trabajo');
    await ports.library.addToSpace('space-1', repos[0]!.id);
    await ports.library.addToSpace('space-1', repos[1]!.id);
    await ports.library.setLayout('spaces');
    renderView(ports);
    await knownRows();

    const openAll = await screen.findByRole('button', {
      name: 'Abrir todos los repositorios de Trabajo',
    });
    expect(openAll).toHaveAttribute('title', 'Abrir todos los repositorios de Trabajo');
    await user.click(openAll);
    await waitFor(() => expect(useShellStore.getState().tabs).toHaveLength(2));
    await user.click(openAll);
    await waitFor(() => expect(useShellStore.getState().tabs).toHaveLength(2));
  });

  it('continúa al fallar un repositorio de Abrir todos y avisa del resultado parcial', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    const repos = await ports.git.listRepositories();
    await ports.library.createSpace('Trabajo');
    await ports.library.addToSpace('space-1', repos[0]!.id);
    await ports.library.addToSpace('space-1', repos[1]!.id);
    await ports.library.setLayout('spaces');
    ports.git.failNext(
      'markOpened',
      new GitOperationError('repo.notFound', {
        repo: repos[0]!.name,
        path: repos[0]!.path,
      }),
    );
    renderView(ports);
    await knownRows();

    await user.click(
      await screen.findByRole('button', { name: 'Abrir todos los repositorios de Trabajo' }),
    );

    await waitFor(() => expect(useShellStore.getState().tabs).toHaveLength(1));
    expect(useShellStore.getState().status).toEqual({
      tone: 'warning',
      key: 'repositories.status.openedSpaceWithFailures',
      params: { space: 'Trabajo', count: 1, failed: 1, cancelled: 0 },
    });
  });

  it('filtra por ruta y conserva una sola lista de resultados', async () => {
    const user = userEvent.setup();
    renderView(makePorts());
    await knownRows();
    await user.type(
      screen.getByLabelText('Filtrar los repositorios por nombre o por ruta'),
      'f2-grafo',
    );
    expect(await knownRows()).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Recientes' })).not.toBeInTheDocument();
  });

  it('al filtrar explica los Espacios de cada resultado', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    await ports.library.createSpace('Trabajo');
    await ports.library.addToSpace('space-1', 'gitthul');
    renderView(ports);
    await knownRows();

    await user.type(
      screen.getByLabelText('Filtrar los repositorios por nombre o por ruta'),
      '/home/example/projects/gitthul',
    );
    expect(within((await knownRows())[0]!).getByText('Trabajo')).toBeInTheDocument();
  });

  it('guarda el orden en LibraryPort', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    renderView(ports);
    await knownRows();
    await user.click(screen.getByRole('radio', { name: 'Por nombre' }));
    await waitFor(async () => expect((await ports.library.read()).sort).toBe('name'));
  });

  it('Abrir elige una carpeta y registra el repositorio real seleccionado', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    ports.system.answerWith('/home/example/projects/tesis');
    renderView(ports);
    await knownRows();

    await user.click(screen.getByRole('button', { name: 'Abrir una carpeta como repositorio' }));

    await waitFor(() =>
      expect(useRepositoriesStore.getState().selected?.path).toBe('/home/example/projects/tesis'),
    );
  });

  it('Crear conserva su dialogo y usa la carpeta elegida para inicializar', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    ports.system.answerWith('/home/example/Nuevos');
    renderView(ports);
    await knownRows();

    await user.click(screen.getByRole('button', { name: 'Crear un repositorio' }));
    const dialog = await screen.findByRole('dialog', { name: 'Crear un repositorio' });
    await user.click(within(dialog).getByRole('button', { name: 'Elegir carpeta' }));
    await user.type(within(dialog).getByLabelText('Nombre'), 'proyecto-real');
    await user.click(within(dialog).getByRole('button', { name: 'Crear' }));

    await waitFor(() =>
      expect(useRepositoriesStore.getState().selected?.path).toBe(
        '/home/example/Nuevos/proyecto-real',
      ),
    );
  });

  it('Clonar conserva su dialogo y usa la carpeta elegida como destino', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    ports.system.answerWith('/home/example/Clones');
    renderView(ports);
    await knownRows();

    await user.click(screen.getByRole('button', { name: 'Clonar un repositorio' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clonar un repositorio' });
    await user.type(
      within(dialog).getByLabelText('Dirección'),
      'https://example.com/equipo/demo.git',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Elegir carpeta' }));
    expect(
      await within(dialog).findByText('La ruta del repositorio será /home/example/Clones/demo'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Clonar' }));

    await waitFor(() =>
      expect(useRepositoriesStore.getState().selected?.path).toBe('/home/example/Clones/demo'),
    );
  });

  it.each(['auth.failed', 'clone.unavailable'] as const)(
    'Clonar permite reintentar %s sin abrir la configuración antigua',
    async (code) => {
      const user = userEvent.setup();
      const ports = makePorts();
      const clone = vi
        .spyOn(ports.git, 'cloneRepository')
        .mockRejectedValueOnce(new GitOperationError(code, { remote: 'example.com' }));
      ports.system.answerWith('/home/example/Clones');
      renderView(ports);
      await knownRows();
      await user.click(screen.getByRole('button', { name: 'Clonar un repositorio' }));
      const dialog = await screen.findByRole('dialog', { name: 'Clonar un repositorio' });
      await user.type(within(dialog).getByLabelText('Dirección'), 'https://example.com/demo.git');
      await user.click(within(dialog).getByRole('button', { name: 'Elegir carpeta' }));
      await user.click(within(dialog).getByRole('button', { name: 'Clonar' }));
      const retry = await within(dialog).findByRole('button', { name: 'Reintentar' });
      expect(
        within(dialog).queryByRole('button', { name: /credenciales/i }),
      ).not.toBeInTheDocument();
      expect(useShellStore.getState().overlay).toBe('none');
      await user.click(retry);
      await waitFor(() => expect(clone).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(useRepositoriesStore.getState().selected?.path).toBe('/home/example/Clones/demo'),
      );
    },
  );

  it('abrir marca Git, suma uso en la biblioteca y abre GitWorking', async () => {
    const ports = makePorts();
    renderView(ports);
    const row = rowAt(await knownRows(), '/home/example/projects/gitthul');
    const target = within(row).getByText('/home/example/projects/gitthul');
    fireEvent.mouseDown(target, { button: 0, detail: 1 });
    fireEvent.click(target, { button: 0, detail: 1 });
    fireEvent.mouseDown(target, { button: 0, detail: 1 });
    fireEvent.click(target, { button: 0, detail: 1 });
    await waitFor(() => expect(useShellStore.getState().tabs[0]?.surface.kind).toBe('working'));
    expect(Object.values((await ports.library.read()).usage)).toEqual([1]);
  });

  it('olvidar confirma alcance y retira solo la entrada conocida', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    renderView(ports);
    const row = rowAt(await knownRows(), '/home/example/projects/gitthul');
    await user.click(within(row).getByText('/home/example/projects/gitthul'));
    await user.keyboard('{Delete}');
    expect(
      screen.queryByRole('dialog', { name: 'Olvidar gitthul en GitThul' }),
    ).not.toBeInTheDocument();
    fireEvent.contextMenu(within(row).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: /^Olvidar en GitThul/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Olvidar gitthul en GitThul' });
    expect(
      within(dialog).getByText(/la carpeta .* y su historial se conservarán/i),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Olvidar gitthul' }));
    await waitFor(() =>
      expect(useRepositoriesStore.getState().repositories?.map((repo) => repo.id)).not.toContain(
        'gitthul',
      ),
    );
  });

  it('localizar valida la carpeta nueva antes de olvidar la anterior', async () => {
    const user = userEvent.setup();
    const ports = makePorts();
    ports.system.answerWith('/home/example/projects/tesis');
    ports.git.failNext(
      'markOpened',
      new GitOperationError('repo.notFound', {
        repo: 'gitthul',
        path: '/home/example/projects/gitthul',
      }),
    );
    renderView(ports);
    const row = rowAt(await knownRows(), '/home/example/projects/gitthul');
    fireEvent.contextMenu(within(row).getByText('/home/example/projects/gitthul'));
    await user.click(await screen.findByRole('menuitem', { name: 'Abrir' }));
    await user.click(await screen.findByRole('button', { name: 'Buscar gitthul en otra carpeta' }));
    await waitFor(() => expect(useRepositoriesStore.getState().selected?.name).toBe('tesis'));
    await screen.findByRole('heading', { name: 'tesis' });
    expect((await ports.git.listRepositories()).map((repo) => repo.id)).not.toContain('gitthul');
  });
});
