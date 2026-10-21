import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { createMockLibraryPort } from '@core/adapters/mock/mockLibraryPort';
import { createMockSystemPort } from '@core/adapters/mock/mockSystemPort';
import { createTauriLibraryPort } from '@core/adapters/tauri/tauriLibraryPort';
import { selectPorts, type AppPorts } from '@core/adapters/selectPorts';
import { GitOperationError, OperationCancelledError } from '@core/domain/errors';
import { DEFAULT_LIBRARY, type Library } from '@core/domain/library';

import { useRepositoriesStore } from './repositoriesStore';
import { baseFor, useRepositoryActions } from './useRepositoryActions';

function makePorts() {
  return {
    ...selectPorts(),
    git: createMockGitPort({ latency: NO_LATENCY }),
    library: createMockLibraryPort(),
    system: createMockSystemPort(),
  };
}

async function loadedActions(ports: AppPorts) {
  const hook = renderHook(useRepositoryActions, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <PortsContext value={ports}>{children}</PortsContext>
    ),
  });
  await act(() => hook.result.current.load());
  return hook.result.current;
}

async function batchFinished() {
  await waitFor(() => expect(useRepositoriesStore.getState().batchBusy).toBe(false));
}

beforeEach(() => {
  useRepositoriesStore.getState().reset();
  useShellStore.getState().reset();
});

describe('repository loading', () => {
  it('keeps an alias saved while listing repositories and preserves alias-filtered selection', async () => {
    const ports = makePorts();
    const actions = await loadedActions(ports);
    const repositories = useRepositoriesStore.getState().repositories!;
    const first = repositories[0]!;
    act(() => useRepositoriesStore.getState().select(first));

    let completeList!: (value: typeof repositories) => void;
    const pendingList = new Promise<typeof repositories>((resolve) => {
      completeList = resolve;
    });
    vi.spyOn(ports.git, 'listRepositories').mockReturnValueOnce(pendingList);
    let loading!: Promise<void>;
    act(() => {
      loading = actions.load();
    });

    await act(async () => {
      const saved = await ports.library.setAlias(first.id, 'Delivery');
      useRepositoriesStore.getState().setLibrary(saved);
      useRepositoriesStore.getState().setFilter('Delivery');
    });
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first.id]));

    await act(async () => {
      completeList(repositories);
      await loading;
    });

    expect(useRepositoriesStore.getState().library?.aliases[first.id]).toBe('Delivery');
    expect(useRepositoriesStore.getState().filter).toBe('Delivery');
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first.id]));
    expect(useRepositoriesStore.getState().selected?.id).toBe(first.id);
  });
});

describe('repository batch actions', () => {
  it('opens each repository once, preserves existing tabs and serializes repeated triggers', async () => {
    const ports = makePorts();
    const actions = await loadedActions(ports);
    const [first, second] = useRepositoriesStore.getState().repositories!;
    useShellStore.getState().openWorking(baseFor(first!));

    let releaseFirst!: () => void;
    const pending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const originalMarkOpened = ports.git.markOpened;
    const markOpened = vi.spyOn(ports.git, 'markOpened').mockImplementation(async (id) => {
      if (id === first!.id) await pending;
      await originalMarkOpened(id);
    });
    const recordOpening = vi.spyOn(ports.library, 'recordOpening');
    const forgetRepository = vi.spyOn(ports.git, 'forgetRepository');

    act(() => {
      actions.openMany([first!, first!, second!]);
      actions.openMany([second!]);
      actions.open(second!);
      actions.forgetMany([second!]);
    });
    expect(useRepositoriesStore.getState().batchBusy).toBe(true);
    expect(markOpened.mock.calls.map(([id]) => id)).toEqual([first!.id]);
    expect(forgetRepository).not.toHaveBeenCalled();

    await act(async () => {
      releaseFirst();
      await pending;
    });
    await batchFinished();
    expect(markOpened.mock.calls.map(([id]) => id)).toEqual([first!.id, second!.id]);
    expect(recordOpening.mock.calls.map(([id]) => id)).toEqual([first!.id, second!.id]);
    expect(useShellStore.getState().tabs.map((tab) => tab.context.repository?.repoId)).toEqual([
      first!.id,
      second!.id,
    ]);
    expect(useShellStore.getState().status).toMatchObject({
      tone: 'success',
      key: 'repositories.status.openedMany',
      params: { count: 2, failed: 0, cancelled: 0 },
    });
  });

  it('continues opening after a failure, keeps its concrete error and separates cancellation', async () => {
    const ports = makePorts();
    const actions = await loadedActions(ports);
    const [failed, opened, cancelled] = useRepositoriesStore.getState().repositories!;
    const error = new GitOperationError('repo.notFound', {
      repo: failed!.name,
      path: failed!.path,
    });
    const originalMarkOpened = ports.git.markOpened;
    vi.spyOn(ports.git, 'markOpened').mockImplementation(async (id) => {
      if (id === failed!.id) throw error;
      if (id === cancelled!.id) throw new OperationCancelledError();
      await originalMarkOpened(id);
    });

    act(() => actions.openMany([failed!, opened!, cancelled!]));
    await batchFinished();
    expect(useShellStore.getState().tabs.map((tab) => tab.context.repository?.repoId)).toEqual([
      opened!.id,
    ]);
    expect(useRepositoriesStore.getState().batchFailures).toEqual([
      { repo: failed, operation: 'open', error },
    ]);
    expect(useRepositoriesStore.getState().openError).toBeNull();
    expect(useShellStore.getState().status).toMatchObject({
      tone: 'warning',
      key: 'repositories.status.openedManyWithFailures',
      params: { count: 1, failed: 1, cancelled: 1 },
    });
  });

  it('forgets only the unique requested repositories and preserves unrelated selection and tabs', async () => {
    const ports = makePorts();
    const actions = await loadedActions(ports);
    const [first, second, unrelated] = useRepositoriesStore.getState().repositories!;
    useRepositoriesStore.getState().selectMany(new Set([first!.id, second!.id, unrelated!.id]));
    useRepositoriesStore.getState().openDialog({ kind: 'forgetMany', repos: [first!, second!] });
    useShellStore.getState().openWorking(baseFor(first!));
    const tabs = useShellStore.getState().tabs;
    const forgetRepository = vi.spyOn(ports.git, 'forgetRepository');

    act(() => actions.forgetMany([first!, first!, second!]));
    expect(useRepositoriesStore.getState().dialog).toEqual({ kind: 'none' });
    await batchFinished();

    expect(forgetRepository.mock.calls.map(([id]) => id)).toEqual([first!.id, second!.id]);
    expect((await ports.git.listRepositories()).map((repo) => repo.id)).not.toContain(first!.id);
    expect((await ports.git.listRepositories()).map((repo) => repo.id)).not.toContain(second!.id);
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([unrelated!.id]));
    expect(useRepositoriesStore.getState().selected?.id).toBe(unrelated!.id);
    expect(useShellStore.getState().tabs).toBe(tabs);
    expect(useShellStore.getState().status).toMatchObject({
      key: 'repositories.status.forgottenMany',
      params: { count: 2 },
    });
  });

  it('continues forgetting after a failure and retains the failed repository in the selection', async () => {
    const ports = makePorts();
    const actions = await loadedActions(ports);
    const [failed, forgotten] = useRepositoriesStore.getState().repositories!;
    useRepositoriesStore.getState().selectMany(new Set([failed!.id, forgotten!.id]));
    const error = new GitOperationError('repo.locked', { repo: failed!.name });
    const originalForget = ports.git.forgetRepository;
    const forgetRepository = vi
      .spyOn(ports.git, 'forgetRepository')
      .mockImplementation(async (id) => {
        if (id === failed!.id) throw error;
        await originalForget(id);
      });

    act(() => actions.forgetMany([failed!, forgotten!]));
    await batchFinished();
    expect(forgetRepository.mock.calls.map(([id]) => id)).toEqual([failed!.id, forgotten!.id]);
    expect(useRepositoriesStore.getState().batchFailures).toEqual([
      { repo: failed, operation: 'forget', error },
    ]);
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([failed!.id]));
    expect((await ports.git.listRepositories()).map((repo) => repo.id)).toContain(failed!.id);
    expect((await ports.git.listRepositories()).map((repo) => repo.id)).not.toContain(
      forgotten!.id,
    );
    expect(useShellStore.getState().status).toMatchObject({
      tone: 'warning',
      key: 'repositories.status.forgottenManyWithFailures',
      params: { count: 1, failed: 1, cancelled: 0 },
    });
  });

  it('releases the batch lock when reloading fails without discarding the successful result', async () => {
    const ports = makePorts();
    const actions = await loadedActions(ports);
    const first = useRepositoriesStore.getState().repositories![0]!;
    const error = new GitOperationError('unknown', {}, { output: 'Library read failed' });
    vi.spyOn(ports.git, 'listRepositories').mockRejectedValueOnce(error);

    act(() => actions.openMany([first]));
    await batchFinished();
    expect(useRepositoriesStore.getState().listError).toBe(error);
    expect(useShellStore.getState().tabs[0]?.context.repository?.repoId).toBe(first.id);
    expect(useShellStore.getState().status).toMatchObject({
      key: 'repositories.status.openedMany',
      params: { count: 1 },
    });
  });

  it('shares the batch lock and concrete failures with opening all repositories in a space', async () => {
    const ports = makePorts();
    const actions = await loadedActions(ports);
    const [failed, opened] = useRepositoriesStore.getState().repositories!;
    const space = { id: 'space-test', name: 'Work', repos: [failed!.id, opened!.id] };
    const error = new GitOperationError('repo.locked', { repo: failed!.name });
    const originalMarkOpened = ports.git.markOpened;
    vi.spyOn(ports.git, 'markOpened').mockImplementation(async (id) => {
      if (id === failed!.id) throw error;
      await originalMarkOpened(id);
    });

    act(() => actions.openAll(space, [failed!, opened!, opened!]));
    expect(useRepositoriesStore.getState().batchBusy).toBe(true);
    await batchFinished();
    expect(useRepositoriesStore.getState().batchFailures).toEqual([
      { repo: failed, operation: 'open', error },
    ]);
    expect(useShellStore.getState().status).toMatchObject({
      key: 'repositories.status.openedSpaceWithFailures',
      params: { space: 'Work', count: 1, failed: 1, cancelled: 0 },
    });
  });
});

describe('adding a repository selection to spaces', () => {
  it('copies every selected ID in one mutation, expands the destination and keeps original memberships', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Origen');
    await ports.library.createSpace('Destino');
    const repositories = await ports.git.listRepositories();
    const [first, second] = repositories;
    await ports.library.addManyToSpace('space-1', [first!.id, second!.id]);
    await ports.library.addToSpace('space-2', second!.id);
    await ports.library.setSpaceCollapsed('space-2', true);
    const actions = await loadedActions(ports);
    useRepositoriesStore.getState().selectMany(new Set([first!.id, second!.id]), 'space:space-1');
    const target = useRepositoriesStore.getState().library!.spaces[1]!;
    const addMany = vi.spyOn(ports.library, 'addManyToSpace');
    const remove = vi.spyOn(ports.library, 'removeFromSpace');
    const setLayout = vi.spyOn(ports.library, 'setLayout');
    const setView = vi.spyOn(ports.library, 'setView');

    act(() => actions.addManyToSpace(target, [first!, second!, first!], true));
    await batchFinished();
    expect(addMany).toHaveBeenCalledExactlyOnceWith(target.id, [first!.id, second!.id], true);
    expect(remove).not.toHaveBeenCalled();
    expect(setLayout).not.toHaveBeenCalled();
    expect(setView).not.toHaveBeenCalled();
    expect((await ports.library.read()).spaces).toEqual([
      { id: 'space-1', name: 'Origen', repos: [first!.id, second!.id] },
      { id: 'space-2', name: 'Destino', repos: [second!.id, first!.id] },
    ]);
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first!.id, second!.id]));
    expect(useRepositoriesStore.getState().selected).toBeNull();
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:space-2');
    expect(useShellStore.getState().status).toMatchObject({
      key: 'repositories.status.addedManyToSpace',
      params: { count: 2, space: 'Destino' },
    });
  });

  it('creates a space with the complete selection atomically and closes the dialog after success', async () => {
    const ports = makePorts();
    const actions = await loadedActions(ports);
    const [first, second] = useRepositoriesStore.getState().repositories!;
    useRepositoriesStore.getState().selectMany(new Set([first!.id, second!.id]));
    useRepositoriesStore.getState().openDialog({ kind: 'createSpace' });
    const createMany = vi.spyOn(ports.library, 'createSpaceAndAddMany');
    const createSingle = vi.spyOn(ports.library, 'createSpace');

    act(() => actions.createSpaceAndAddMany('  Entrega  ', [first!, second!, first!]));
    await batchFinished();
    expect(createMany).toHaveBeenCalledExactlyOnceWith('Entrega', [first!.id, second!.id]);
    expect(createSingle).not.toHaveBeenCalled();
    expect(useRepositoriesStore.getState().dialog).toEqual({ kind: 'none' });
    expect(useRepositoriesStore.getState().library).toMatchObject({
      spaces: [{ name: 'Entrega', repos: [first!.id, second!.id] }],
      layout: 'spaces',
      view: { kind: 'space', id: 'space-1' },
    });
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first!.id, second!.id]));
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:space-1');
  });

  it('does not claim success when the drop destination no longer exists', async () => {
    const ports = makePorts();
    const actions = await loadedActions(ports);
    const [first, second] = useRepositoriesStore.getState().repositories!;
    useRepositoriesStore.getState().selectMany(new Set([first!.id, second!.id]));

    act(() =>
      actions.addManyToSpace(
        { id: 'missing', name: 'Desaparecido', repos: [] },
        [first!, second!],
        true,
      ),
    );
    await batchFinished();
    expect(useRepositoriesStore.getState().openError).toMatchObject({
      code: 'unknown',
      output: 'The space "Desaparecido" no longer exists',
    });
    expect(useRepositoriesStore.getState().openErrorSource).toBe('space');
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first!.id, second!.id]));
    expect((await ports.library.read()).spaces).toEqual([]);
    expect(useShellStore.getState().status).toMatchObject({
      tone: 'warning',
      key: 'repositories.status.addManyToSpaceFailed',
    });
  });

  it('a rejected native write allows a real retry of the same drop and preserves its concrete error', async () => {
    const ports = makePorts();
    let disk: Library = {
      ...DEFAULT_LIBRARY,
      spaces: [{ id: 'space-1', name: 'Entrega', repos: [] }],
    };
    let writes = 0;
    const library = createTauriLibraryPort((command, args) => {
      if (command === 'library_read') return Promise.resolve(structuredClone(disk));
      writes += 1;
      if (writes === 1) return Promise.reject(new Error('Permission denied'));
      disk = structuredClone(args?.['library']) as Library;
      return Promise.resolve(undefined);
    });
    const actions = await loadedActions({ ...ports, library });
    const [first, second] = useRepositoriesStore.getState().repositories!;
    useRepositoriesStore.getState().selectMany(new Set([first!.id, second!.id]));
    const target = disk.spaces[0]!;

    act(() => actions.addManyToSpace(target, [first!, second!], true));
    await batchFinished();
    expect(useRepositoriesStore.getState().openError).toMatchObject({
      output: 'Permission denied',
    });
    expect(disk.spaces[0]?.repos).toEqual([]);
    expect((await library.read()).spaces[0]?.repos).toEqual([]);
    act(() => actions.addManyToSpace(target, [first!, second!], true));
    await batchFinished();
    expect(writes).toBe(2);
    expect(disk.spaces[0]?.repos).toEqual([first!.id, second!.id]);
    expect(useRepositoriesStore.getState().openError).toBeNull();
    expect(useShellStore.getState().status?.tone).toBe('success');
  });

  it('guards repeated drops during persistence and restores the complete captured selection', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Entrega');
    const actions = await loadedActions(ports);
    const [first, second, unrelated] = useRepositoriesStore.getState().repositories!;
    const target = useRepositoriesStore.getState().library!.spaces[0]!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalAdd = ports.library.addManyToSpace;
    const addMany = vi
      .spyOn(ports.library, 'addManyToSpace')
      .mockImplementation((id, ids, reveal) => pending.then(() => originalAdd(id, ids, reveal)));
    const createMany = vi.spyOn(ports.library, 'createSpaceAndAddMany');
    const markOpened = vi.spyOn(ports.git, 'markOpened');

    act(() => {
      actions.addManyToSpace(target, [first!, second!]);
      actions.addManyToSpace(target, [unrelated!]);
      actions.createSpaceAndAddMany('Otro', [unrelated!]);
      actions.openMany([unrelated!]);
      useRepositoriesStore.getState().select(unrelated!);
    });
    expect(useRepositoriesStore.getState().batchBusy).toBe(true);
    expect(addMany).toHaveBeenCalledOnce();
    expect(createMany).not.toHaveBeenCalled();
    expect(markOpened).not.toHaveBeenCalled();
    act(() => release());
    await batchFinished();
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first!.id, second!.id]));
    expect((await ports.library.read()).spaces[0]?.repos).toEqual([first!.id, second!.id]);
  });

  it('keeps the creation dialog and selection when the name collides with an existing space', async () => {
    const ports = makePorts();
    await ports.library.createSpace('Entrega');
    const actions = await loadedActions(ports);
    const [first, second] = useRepositoriesStore.getState().repositories!;
    useRepositoriesStore.getState().selectMany(new Set([first!.id, second!.id]));
    useRepositoriesStore.getState().openDialog({ kind: 'createSpace' });
    const createMany = vi.spyOn(ports.library, 'createSpaceAndAddMany');

    act(() => actions.createSpaceAndAddMany('Entrega', [first!, second!]));
    await batchFinished();
    expect(createMany).not.toHaveBeenCalled();
    expect(useRepositoriesStore.getState().dialog.kind).toBe('createSpace');
    expect(useRepositoriesStore.getState().openError).toMatchObject({
      output: 'A space named "Entrega" already exists',
    });
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first!.id, second!.id]));
    expect((await ports.library.read()).spaces[0]?.repos).toEqual([]);
  });
});

describe('removing repository memberships', () => {
  it('removes the affected selection from one space and preserves its other memberships, tabs and catalog', async () => {
    const ports = makePorts();
    const [first, second, unrelated] = await ports.git.listRepositories();
    await ports.library.createSpaceAndAddMany('Uno', [first!.id, second!.id]);
    await ports.library.createSpaceAndAddMany('Dos', [first!.id, second!.id, unrelated!.id]);
    const actions = await loadedActions(ports);
    useRepositoriesStore
      .getState()
      .selectMany(new Set([first!.id, second!.id, unrelated!.id]), 'space:space-1');
    useShellStore.getState().openWorking(baseFor(first!));
    const tabs = useShellStore.getState().tabs;
    const repositories = useRepositoriesStore.getState().repositories;
    const remove = vi.spyOn(ports.library, 'removeManyFromSpaces');
    const forget = vi.spyOn(ports.git, 'forgetRepository');
    const target = useRepositoriesStore.getState().library!.spaces[0]!;

    act(() => actions.removeManyFromSpace(target, [first!, second!, first!]));
    await batchFinished();
    expect(remove).toHaveBeenCalledExactlyOnceWith([first!.id, second!.id], ['space-1']);
    expect((await ports.library.read()).spaces).toEqual([
      { id: 'space-1', name: 'Uno', repos: [] },
      { id: 'space-2', name: 'Dos', repos: [first!.id, second!.id, unrelated!.id] },
    ]);
    expect(useRepositoriesStore.getState().selectedIds).toEqual(
      new Set([first!.id, second!.id, unrelated!.id]),
    );
    expect(useRepositoriesStore.getState().selectedFrom).toBe('all');
    expect(useRepositoriesStore.getState().repositories).toBe(repositories);
    expect(useShellStore.getState().tabs).toBe(tabs);
    expect(forget).not.toHaveBeenCalled();
    expect(useShellStore.getState().status).toMatchObject({
      tone: 'success',
      key: 'repositories.status.removedManyFromSpace',
      params: { count: 2, space: 'Uno' },
    });
  });

  it('removes memberships from separate spaces only through separate requests', async () => {
    const ports = makePorts();
    const [first, second, unrelated] = await ports.git.listRepositories();
    await ports.library.createSpaceAndAddMany('Uno', [first!.id, second!.id]);
    await ports.library.createSpaceAndAddMany('Dos', [first!.id, second!.id, unrelated!.id]);
    const actions = await loadedActions(ports);
    useRepositoriesStore.getState().selectMany(new Set([first!.id, second!.id]), 'space:space-2');
    const remove = vi.spyOn(ports.library, 'removeManyFromSpaces');
    const [one, two] = useRepositoriesStore.getState().library!.spaces;

    act(() => actions.removeManyFromSpace(one!, [first!, second!, first!]));
    await batchFinished();
    expect(remove).toHaveBeenCalledExactlyOnceWith([first!.id, second!.id], ['space-1']);
    expect((await ports.library.read()).spaces).toEqual([
      { id: 'space-1', name: 'Uno', repos: [] },
      { id: 'space-2', name: 'Dos', repos: [first!.id, second!.id, unrelated!.id] },
    ]);
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:space-2');

    act(() => actions.removeManyFromSpace(two!, [first!, second!]));
    await batchFinished();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenLastCalledWith([first!.id, second!.id], ['space-2']);
    expect((await ports.library.read()).spaces).toEqual([
      { id: 'space-1', name: 'Uno', repos: [] },
      { id: 'space-2', name: 'Dos', repos: [unrelated!.id] },
    ]);
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first!.id, second!.id]));
    expect(useRepositoriesStore.getState().selectedFrom).toBe('all');
    expect(useShellStore.getState().status).toMatchObject({
      key: 'repositories.status.removedManyFromSpace',
      params: { count: 2, space: 'Dos' },
    });
  });

  it('delegates singular removal and retains an unaffected selection origin', async () => {
    const ports = makePorts();
    const [first] = await ports.git.listRepositories();
    await ports.library.createSpaceAndAddMany('Uno', [first!.id]);
    await ports.library.createSpaceAndAddMany('Dos', [first!.id]);
    const actions = await loadedActions(ports);
    useRepositoriesStore.getState().select(first!, 'space:space-2');
    const remove = vi.spyOn(ports.library, 'removeManyFromSpaces');
    const target = useRepositoriesStore.getState().library!.spaces[0]!;

    act(() => actions.removeFromSpace(target, first!));
    await batchFinished();
    expect(remove).toHaveBeenCalledExactlyOnceWith([first!.id], ['space-1']);
    expect(useRepositoriesStore.getState().selected?.id).toBe(first!.id);
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:space-2');
    expect(useShellStore.getState().status).toMatchObject({
      key: 'repositories.status.removedFromSpace',
      params: { repo: first!.name, space: 'Uno' },
    });
  });

  it('a failed native removal preserves memberships and selection and the same request can be retried', async () => {
    const ports = makePorts();
    const [first, second] = await ports.git.listRepositories();
    let disk: Library = {
      ...DEFAULT_LIBRARY,
      spaces: [{ id: 'space-1', name: 'Uno', repos: [first!.id, second!.id] }],
    };
    let writes = 0;
    const library = createTauriLibraryPort((command, args) => {
      if (command === 'library_read') return Promise.resolve(structuredClone(disk));
      writes += 1;
      if (writes === 1) return Promise.reject(new Error('Permission denied'));
      disk = structuredClone(args?.['library']) as Library;
      return Promise.resolve(undefined);
    });
    const actions = await loadedActions({ ...ports, library });
    useRepositoriesStore.getState().selectMany(new Set([first!.id, second!.id]), 'space:space-1');
    const target = disk.spaces[0]!;
    const onRemoved = vi.fn();

    act(() => actions.removeManyFromSpace(target, [first!, second!], onRemoved));
    await batchFinished();
    expect(useRepositoriesStore.getState().openError).toMatchObject({
      output: 'Permission denied',
    });
    expect(useRepositoriesStore.getState().openErrorSource).toBe('space');
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:space-1');
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first!.id, second!.id]));
    expect(disk.spaces[0]?.repos).toEqual([first!.id, second!.id]);
    expect(onRemoved).not.toHaveBeenCalled();
    act(() => actions.removeManyFromSpace(target, [first!, second!], onRemoved));
    await batchFinished();
    expect(writes).toBe(2);
    expect(disk.spaces[0]?.repos).toEqual([]);
    expect(useRepositoriesStore.getState().openError).toBeNull();
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([first!.id, second!.id]));
    expect(useRepositoriesStore.getState().selectedFrom).toBe('all');
    expect(onRemoved).toHaveBeenCalledOnce();
  });

  it('guards repeated removal while pending and preserves selection changes made during the await', async () => {
    const ports = makePorts();
    const [first, second, unrelated] = await ports.git.listRepositories();
    await ports.library.createSpaceAndAddMany('Uno', [first!.id, second!.id]);
    const actions = await loadedActions(ports);
    useRepositoriesStore.getState().selectMany(new Set([first!.id, second!.id]), 'space:space-1');
    const target = useRepositoriesStore.getState().library!.spaces[0]!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalRemove = ports.library.removeManyFromSpaces;
    const remove = vi
      .spyOn(ports.library, 'removeManyFromSpaces')
      .mockImplementation((ids, spaces) => pending.then(() => originalRemove(ids, spaces)));

    act(() => {
      actions.removeManyFromSpace(target, [first!, second!]);
      actions.removeManyFromSpace(target, [first!]);
      actions.forgetMany([second!]);
      useRepositoriesStore.getState().select(unrelated!, 'recent');
    });
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(useRepositoriesStore.getState().batchBusy).toBe(true);
    act(() => release());
    await batchFinished();
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set([unrelated!.id]));
    expect(useRepositoriesStore.getState().selectedFrom).toBe('recent');
    expect((await ports.git.listRepositories()).map((repo) => repo.id)).toContain(second!.id);
  });

  it('does not treat cancellation or a missing space as a successful removal', async () => {
    const ports = makePorts();
    const [first] = await ports.git.listRepositories();
    await ports.library.createSpaceAndAddMany('Uno', [first!.id]);
    const actions = await loadedActions(ports);
    useRepositoriesStore.getState().select(first!, 'space:space-1');
    const target = useRepositoriesStore.getState().library!.spaces[0]!;
    const remove = vi
      .spyOn(ports.library, 'removeManyFromSpaces')
      .mockRejectedValueOnce(new OperationCancelledError());

    act(() => actions.removeManyFromSpace(target, [first!]));
    await batchFinished();
    expect(useRepositoriesStore.getState().openError).toBeNull();
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:space-1');
    expect((await ports.library.read()).spaces[0]?.repos).toEqual([first!.id]);
    expect(useShellStore.getState().status?.key).toBe(
      'repositories.status.removeManyFromSpaceCancelled',
    );
    act(() => actions.removeManyFromSpace({ id: 'missing', name: 'Ausente', repos: [] }, [first!]));
    await batchFinished();
    expect(remove).toHaveBeenCalledOnce();
    expect(useRepositoriesStore.getState().openError).toMatchObject({
      output: 'The space "Ausente" no longer exists',
    });
    expect(useShellStore.getState().status?.tone).toBe('warning');
  });

  it('reports only repository IDs that actually belonged to the requested scope', async () => {
    const ports = makePorts();
    const [first, unrelated] = await ports.git.listRepositories();
    await ports.library.createSpaceAndAddMany('Uno', [first!.id]);
    const actions = await loadedActions(ports);
    const target = useRepositoriesStore.getState().library!.spaces[0]!;

    act(() => actions.removeManyFromSpace(target, [first!, unrelated!, first!]));
    await batchFinished();
    expect(useShellStore.getState().status).toMatchObject({
      key: 'repositories.status.removedManyFromSpace',
      params: { count: 1, space: 'Uno' },
    });
    act(() => actions.removeManyFromSpace(target, [first!, unrelated!]));
    await batchFinished();
    expect(useShellStore.getState().status).toMatchObject({
      tone: 'info',
      params: { count: 0 },
    });
  });
});
