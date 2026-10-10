import { describe, expect, it } from 'vitest';

import { fileChange } from '@core/adapters/mock/fixture/history';
import { buildLargeRepo } from '@core/adapters/mock/fixture/large';
import type { Commit } from '@core/domain/commit';
import type { Stash } from '@core/domain/refs';
import type { WorkingStatus } from '@core/domain/status';

import { buildCommitRows, wipFileCount } from './commits';

const CLEAN: WorkingStatus = { staged: [], unstaged: [], conflicted: [], clean: true };

function commit(sha: string, overrides: Partial<Commit> = {}): Commit {
  return {
    sha,
    parents: [],
    summary: `Commit ${sha}`,
    body: '',
    author: { name: 'Alex', email: 'alex@example.org' },
    authoredAt: 0,
    committer: { name: 'Alex', email: 'alex@example.org' },
    committedAt: 0,
    ...overrides,
  };
}

function stash(index: number, sha: string, createdAt = 0): Stash {
  return { index, sha, base: sha, message: 'WIP', branch: 'main', createdAt, fileCount: 2 };
}

describe('wipFileCount', () => {
  it('cuenta rutas distintas, sin duplicar la que está a la vez preparada y sin preparar', () => {
    const status: WorkingStatus = {
      staged: [fileChange('a.ts', 'modified', 1), fileChange('shared.ts', 'modified', 2)],
      unstaged: [fileChange('shared.ts', 'modified', 3), fileChange('b.ts', 'modified', 4)],
      conflicted: [],
      clean: false,
    };

    expect(wipFileCount(status)).toBe(3);
  });

  it('con el árbol limpio no hay nada que contar', () => {
    expect(wipFileCount(CLEAN)).toBe(0);
  });
});

describe('buildCommitRows', () => {
  it('sin nada sucio y sin guardados, solo hay filas de commit', () => {
    const commits = [commit('a'), commit('b')];

    const rows = buildCommitRows(commits, CLEAN, []);

    expect(rows).toEqual([
      { kind: 'commit', key: 'a', commit: commits[0] },
      { kind: 'commit', key: 'b', commit: commits[1] },
    ]);
  });

  it('el árbol sucio antepone el nodo WIP con su conteo de archivos', () => {
    const status: WorkingStatus = {
      staged: [fileChange('a.ts', 'modified', 1)],
      unstaged: [],
      conflicted: [],
      clean: false,
    };

    const rows = buildCommitRows([commit('a')], status, []);

    expect(rows[0]).toEqual({ kind: 'wip', key: 'wip', fileCount: 1, label: null });
  });

  it('un guardado tan reciente como el historial aparece antes del primer commit', () => {
    const commits = [commit('a'), commit('b'), commit('c')];
    const stashes = [stash(0, 'b')];

    const rows = buildCommitRows(commits, CLEAN, stashes);

    expect(rows.map((row) => row.key)).toEqual(['stash:0', 'a', 'b', 'c']);
  });

  it('varios guardados de la misma fecha conservan el orden de la pila', () => {
    const commits = [commit('a')];
    const stashes = [stash(0, 'a'), stash(1, 'a')];

    const rows = buildCommitRows(commits, CLEAN, stashes);

    expect(rows.map((row) => row.key)).toEqual(['stash:0', 'stash:1', 'a']);
  });

  it('un guardado cuya posición no está en la página cargada aparece igual', () => {
    const rows = buildCommitRows([commit('a')], CLEAN, [stash(0, 'no-cargado')]);

    expect(rows.map((row) => row.key)).toEqual(['stash:0', 'a']);
  });

  it('intercala cada guardado en su fecha en vez de llevarlo al tope', () => {
    const commits = [
      commit('nuevo', { authoredAt: 0, committedAt: 300 }),
      commit('medio', { authoredAt: 0, committedAt: 200 }),
      commit('viejo', { authoredAt: 0, committedAt: 100 }),
    ];
    const stashes = [stash(0, 'stash-nuevo', 250), stash(1, 'stash-viejo', 150)];

    const rows = buildCommitRows(commits, CLEAN, stashes);

    expect(rows.map((row) => row.key)).toEqual(['nuevo', 'stash:0', 'medio', 'stash:1', 'viejo']);
  });

  it('un stash precede a su base aunque el commit tenga una fecha posterior', () => {
    const commits = [commit('hijo', { committedAt: 400 }), commit('base', { committedAt: 300 })];
    const guardado = { ...stash(0, 's', 200), base: 'base' };

    expect(buildCommitRows(commits, CLEAN, [guardado]).map((row) => row.key)).toEqual([
      'hijo',
      'stash:0',
      'base',
    ]);
  });
});

/*
 * Puro y sin montar nada, la misma disciplina que `graph.ts` mantiene desde
 * F2.3: cien mil commits solo deberían costar recorrerlos una vez.
 */
describe('rendimiento', () => {
  it('reparte cien mil commits en menos de un segundo', () => {
    const { history, status, refs } = buildLargeRepo({ commitCount: 100_000, branchCount: 8 });

    const start = performance.now();
    const rows = buildCommitRows(history.commits, status, refs.stashes);
    const elapsed = performance.now() - start;

    expect(rows.length).toBeGreaterThanOrEqual(history.commits.length);
    expect(elapsed).toBeLessThan(1000);
  });
});
