import { describe, expect, it } from 'vitest';

import { buildLargeRepo, buildLargeWorld, LARGE_REPO_ID } from './large';
import { buildWorld } from './world';

const SPEC = { commitCount: 4_000, branchCount: 8 };

describe('el mundo grande', () => {
  it('produce al menos los commits que se le piden, con sus ramas vivas', () => {
    const repo = buildLargeRepo(SPEC);
    const locales = repo.refs.branches.filter((branch) => branch.kind === 'local');

    expect(repo.history.commits.length).toBeGreaterThanOrEqual(SPEC.commitCount);
    // Las ocho pedidas más la principal, que no se cuenta entre ellas.
    expect(locales).toHaveLength(SPEC.branchCount + 1);
    expect(locales.filter((branch) => branch.isHead)).toHaveLength(1);
  });

  it('cada punta apunta a un commit que existe', () => {
    const repo = buildLargeRepo(SPEC);
    const shas = new Set(repo.history.commits.map((commit) => commit.sha));

    for (const branch of repo.refs.branches) expect(shas.has(branch.tip)).toBe(true);
    for (const stash of repo.refs.stashes) expect(shas.has(stash.sha)).toBe(true);
    expect(shas.has(repo.refs.head.sha)).toBe(true);
  });

  /*
   * El grafo dibuja de arriba abajo dando por hecho que cuando llega a un commit
   * ya vio a sus hijos. Es la misma invariante que el mundo de siempre, y la que
   * hace que medir contra este sea medir contra algo dibujable.
   */
  it('sale del más nuevo al más viejo y ningún padre aparece antes que su hijo', () => {
    const { commits } = buildLargeRepo({ commitCount: 400, branchCount: 4 }).history;
    const position = new Map(commits.map((commit, index) => [commit.sha, index]));

    for (const [index, commit] of commits.entries()) {
      for (const parent of commit.parents) {
        expect(position.get(parent) ?? Infinity).toBeGreaterThan(index);
      }
    }
  });

  it('la misma semilla cuenta la misma historia, y otra cuenta otra', () => {
    const spec = { commitCount: 200, branchCount: 2 };
    const uno = buildLargeRepo(spec).history.commits;
    const otro = buildLargeRepo(spec).history.commits;
    const distinto = buildLargeRepo({ ...spec, seed: 7 }).history.commits;

    expect(uno.map((commit) => commit.sha)).toEqual(otro.map((commit) => commit.sha));
    expect(uno[0]?.sha).not.toBe(distinto[0]?.sha);
  });

  /*
   * Convive con el mundo de siempre, no lo sustituye: los cuatro repositorios
   * reconocibles siguen siendo los de las demás pruebas y los de la ventana.
   */
  it('es un mundo aparte de los cuatro repositorios de siempre', () => {
    const world = buildLargeWorld({ commitCount: 100, branchCount: 1 });

    expect([...world.repos.keys()]).toEqual([LARGE_REPO_ID]);
    expect([...buildWorld().repos.keys()]).not.toContain(LARGE_REPO_ID);
  });
});
