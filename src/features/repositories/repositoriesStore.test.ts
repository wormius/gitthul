import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_LIBRARY } from '@core/domain/library';
import type { RepoSummary } from '@core/domain/repository';

import { useRepositoriesStore } from './repositoriesStore';

const REPOS: readonly RepoSummary[] = [
  { id: 'one', name: 'Árbol', path: '/fixtures/one', head: 'main', lastOpenedAt: null },
  { id: 'two', name: 'Segundo', path: '/fixtures/two', head: 'dev', lastOpenedAt: null },
  { id: 'three', name: 'Tercero', path: '/fixtures/three', head: 'main', lastOpenedAt: null },
];

beforeEach(() => {
  useRepositoriesStore.getState().reset();
  useRepositoriesStore.getState().loaded(REPOS, DEFAULT_LIBRARY);
});

describe('repositoriesStore selection', () => {
  it('only supplies single-repository tools with an unambiguous target', () => {
    const store = useRepositoriesStore.getState();
    store.selectMany(new Set(['one', 'two']), 'space:example');
    expect(useRepositoriesStore.getState().selected).toBeNull();
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set(['one', 'two']));
    expect(useRepositoriesStore.getState().selectedFrom).toBe('space:example');

    store.selectMany(new Set(['two']));
    expect(useRepositoriesStore.getState().selected?.id).toBe('two');
    store.select(null);
    expect(useRepositoriesStore.getState().selectedIds.size).toBe(0);
  });

  it('drops hidden repositories when filtering without reselecting them when cleared', () => {
    const store = useRepositoriesStore.getState();
    store.selectMany(new Set(['one', 'two', 'three']));
    store.setFilter('arbol');
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set(['one']));
    expect(useRepositoriesStore.getState().selected?.name).toBe('Árbol');
    store.setFilter('');
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set(['one']));
  });

  it('keeps known selections across reloads and discards removed or unknown IDs', () => {
    const store = useRepositoriesStore.getState();
    store.selectMany(new Set(['one', 'two', 'missing']));
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set(['one', 'two']));
    const updated = REPOS.filter((repo) => repo.id !== 'one').map((repo) => ({
      ...repo,
      head: 'next',
    }));
    store.loaded(updated, DEFAULT_LIBRARY);
    expect(useRepositoriesStore.getState().selectedIds).toEqual(new Set(['two']));
    expect(useRepositoriesStore.getState().selected?.head).toBe('next');
  });
});
