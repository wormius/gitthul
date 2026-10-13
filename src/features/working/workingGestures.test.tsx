import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { useShellStore } from '@app/shellStore';
import { I18nProvider } from '@i18n/I18nProvider';

import { useWorkingGestureDefinitions } from './workingGestures';
import { useWorkingStore, type SelectedRef } from './workingStore';

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLocale="es-MX">{children}</I18nProvider>;
}

beforeEach(() => {
  useWorkingStore.getState().reset();
  useShellStore.getState().reset();
  useShellStore.getState().openWorking({
    repoId: 'repo',
    repoName: 'repo',
    repoPath: '/tmp/repo',
    branch: 'main',
  });
  useWorkingStore.getState().setContext({
    repoId: 'repo',
    repoName: 'repo',
    headBranch: 'main',
    headSha: 'head',
    headUpstream: null,
    remoteNames: ['origin'],
    stagedCount: 0,
    trackedCount: 0,
    resetPrecondition: { head: 'head', indexTree: 'index', worktreeTree: 'worktree' },
  });
});

afterEach(() => {
  act(() => {
    useWorkingStore.getState().reset();
    useShellStore.getState().reset();
  });
});

it.each<[SelectedRef['kind'], string, string]>([
  ['localBranch', 'dev', 'refs/heads/dev'],
  ['remoteBranch', 'origin/dev', 'refs/remotes/origin/dev'],
  ['tag', 'main', 'refs/tags/main'],
])('comparar desde la búsqueda conserva la identidad de %s %s', (kind, name, ref) => {
  useWorkingStore.getState().setSelectedRef({ kind, name, target: 'tip', isHead: false });
  const { result } = renderHook(useWorkingGestureDefinitions, { wrapper });
  const compare = result.current.find((gesture) => gesture.id === 'working.compare');

  expect(compare?.disabled).toBe(false);
  act(() => compare?.run());

  expect(useWorkingStore.getState().compare).toEqual({
    kind: 'refs',
    source: { ref, label: name },
    target: { ref: 'refs/heads/main', label: 'main' },
  });
});

it('comparar la rama activa consigo misma permanece deshabilitado', () => {
  useWorkingStore.getState().setSelectedRef({
    kind: 'localBranch',
    name: 'main',
    target: 'head',
    isHead: true,
  });
  const { result } = renderHook(useWorkingGestureDefinitions, { wrapper });

  expect(result.current.find((gesture) => gesture.id === 'working.compare')?.disabled).toBe(true);
});
