import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { selectPorts } from '@core/adapters/selectPorts';
import type { Worktree } from '@core/domain/refs';

import { useWorkingActions } from './useWorkingActions';
import { useWorkingStore } from './workingStore';

const worktree: Worktree = {
  name: 'linked',
  path: '/repos/linked',
  branch: 'topic',
  head: 'a'.repeat(40),
  isMain: false,
  locked: false,
  missing: false,
};

beforeEach(() => {
  useShellStore.getState().reset();
  useWorkingStore.getState().reset();
});

function setup() {
  const git = createMockGitPort({ latency: NO_LATENCY });
  const ports = { ...selectPorts(), git };
  const applyRefs = vi.fn();
  const hook = renderHook(
    () =>
      useWorkingActions({
        repoId: 'gitthul',
        repoPath: '/repo',
        applyRefs,
        applyStatus: vi.fn(),
        applyUndoStack: vi.fn(),
        setAllSectionsCollapsed: vi.fn(),
        setNodeForm: vi.fn(),
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PortsContext value={ports}>{children}</PortsContext>
      ),
    },
  );
  return { git, applyRefs, actions: hook.result };
}

it('registra y abre un worktree externo que aún no está en la biblioteca', async () => {
  const { git, actions } = setup();
  const repository = {
    ...(await git.readRepository('gitthul')),
    id: worktree.path,
    path: worktree.path,
    name: worktree.name,
    head: worktree.branch,
  };
  vi.spyOn(git, 'listRepositories').mockResolvedValue([]);
  const open = vi.spyOn(git, 'openRepository').mockResolvedValue(repository);
  act(() => actions.current.openWorktree(worktree));
  await waitFor(() => expect(useShellStore.getState().tabs).toHaveLength(1));
  expect(open).toHaveBeenCalledWith(worktree.path);
  expect(useShellStore.getState().tabs[0]?.surface).toMatchObject({ repoPath: worktree.path });
});

it('quita sin forzar y cierra la pestaña únicamente después del éxito', async () => {
  const { git, actions, applyRefs } = setup();
  const refs = await git.readRefs('gitthul');
  const remove = vi.spyOn(git, 'removeWorktree').mockRejectedValueOnce(new Error('dirty'));
  useShellStore.getState().openWorking({
    repoId: worktree.path,
    repoPath: worktree.path,
    repoName: worktree.name,
    branch: worktree.branch,
  });
  act(() => actions.current.confirmRemoveWorktree(worktree));
  await waitFor(() => expect(useShellStore.getState().status?.tone).toBe('danger'));
  expect(useShellStore.getState().tabs).toHaveLength(1);
  expect(applyRefs).not.toHaveBeenCalled();
  remove.mockResolvedValue(refs);
  act(() => actions.current.confirmRemoveWorktree(worktree));
  await waitFor(() => expect(useShellStore.getState().tabs).toHaveLength(0));
  expect(remove).toHaveBeenLastCalledWith('gitthul', worktree.path);
  expect(applyRefs).toHaveBeenCalledWith(refs);
});
