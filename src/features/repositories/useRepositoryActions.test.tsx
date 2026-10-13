import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { createMockLibraryPort } from '@core/adapters/mock/mockLibraryPort';
import { createMockSystemPort } from '@core/adapters/mock/mockSystemPort';
import { selectPorts, type AppPorts } from '@core/adapters/selectPorts';
import { GitOperationError, OperationCancelledError } from '@core/domain/errors';

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
