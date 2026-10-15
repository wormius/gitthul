import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { selectPorts } from '@core/adapters/selectPorts';
import type { WorkingStatus } from '@core/domain/status';

import { useWorkingActions } from './useWorkingActions';
import { useWorkingStore } from './workingStore';

beforeEach(() => {
  useShellStore.getState().reset();
  useWorkingStore.getState().reset();
});

it.each([
  { pattern: '*.log', untrack: false, kind: undefined, expectedKind: 'path' },
  { pattern: '*.log', untrack: false, kind: 'extension', expectedKind: 'extension' },
  { pattern: 'cache/', untrack: true, kind: undefined, expectedKind: 'path' },
] as const)('transporta el alcance $expectedKind de $pattern al puerto', async (entry) => {
  const git = createMockGitPort({ latency: NO_LATENCY });
  const ports = { ...selectPorts(), git };
  const status: WorkingStatus = { staged: [], unstaged: [], conflicted: [], clean: true };
  const ignore = vi.spyOn(git, 'ignorePath').mockResolvedValue(status);
  const applyStatus = vi.fn();
  const hook = renderHook(
    () =>
      useWorkingActions({
        repoId: 'gitthul',
        repoPath: '/repo',
        applyRepository: vi.fn(),
        applyRefs: vi.fn(),
        applyStatus,
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

  act(() => hook.result.current.ignorePath(entry.pattern, entry.untrack, entry.kind));

  await waitFor(() => expect(useWorkingStore.getState().pendingWrites).toBe(0));
  expect(ignore).toHaveBeenCalledWith('gitthul', entry.pattern, {
    untrack: entry.untrack,
    patternKind: entry.expectedKind,
  });
  expect(applyStatus).toHaveBeenCalledWith(status);
  expect(useShellStore.getState().status?.key).toBe(
    entry.untrack ? 'working.status.ignoredAndUntracked' : 'working.status.ignored',
  );
});
