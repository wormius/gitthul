import { describe, expect, it } from 'vitest';

import { buildLargeRepo } from '@core/adapters/mock/fixture/large';
import type { Commit } from '@core/domain/commit';
import type { RefsSnapshot, Stash } from '@core/domain/refs';
import type { WorkingStatus } from '@core/domain/status';

import { buildCommitRows } from './commits';
import { buildGraph, buildGraphAsync, type GraphLayout } from './graph';

const CLEAN: WorkingStatus = { staged: [], unstaged: [], conflicted: [], clean: true };
const DIRTY: WorkingStatus = {
  staged: [],
  unstaged: [{ path: 'a.ts', change: 'modified', binary: false, insertions: 1, deletions: 0 }],
  conflicted: [],
  clean: false,
};

function commit(sha: string, parents: readonly string[] = []): Commit {
  return {
    sha,
    parents,
    summary: `Commit ${sha}`,
    body: '',
    author: { name: 'Alex Rivera', email: 'alex@example.org' },
    authoredAt: 0,
    committer: { name: 'Alex Rivera', email: 'alex@example.org' },
    committedAt: 0,
  };
}

function stash(index: number, sha: string, base = sha): Stash {
  return { index, sha, base, message: 'WIP', branch: 'main', createdAt: 0, fileCount: 1 };
}

function refsAt(headSha: string, stashes: readonly Stash[] = []): RefsSnapshot {
  return {
    head: { branch: 'main', sha: headSha, detached: false },
    branches: [],
    tags: [],
    stashes,
    worktrees: [],
    remotes: [],
  };
}

/** Las calles de cada fila, que es lo que casi toda prueba de aquí compara. */
function lanes(layout: GraphLayout): number[] {
  return Array.from({ length: layout.rowCount }, (_, row) => layout.nodeAt(row).lane);
}

function colors(layout: GraphLayout): number[] {
  return Array.from({ length: layout.rowCount }, (_, row) => layout.nodeAt(row).color);
}

/**
 * La historia de referencia de estas pruebas, de la más nueva a la más vieja:
 *
 * ```
 * m3 ─┐            calle 0
 * m2 ─┤ fusión     calle 0, con b2 entrando por la derecha
 * b2  │ ─┐         calle 1
 * b1  │  │         calle 1
 * m1 ─┘  │         calle 0
 * m0 ────┘         calle 0, raíz: las dos calles mueren aquí
 * ```
 */
function branchedHistory(): readonly Commit[] {
  return [
    commit('m3', ['m2']),
    commit('m2', ['m1', 'b2']),
    commit('b2', ['b1']),
    commit('b1', ['m0']),
    commit('m1', ['m0']),
    commit('m0'),
  ];
}

describe('buildGraph · una sola línea', () => {
  it('una historia sin ramas cabe entera en la calle 0', () => {
    const commits = [commit('c', ['b']), commit('b', ['a']), commit('a')];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('c'));

    expect(lanes(layout)).toEqual([0, 0, 0]);
    expect(layout.laneCount).toBe(1);
  });

  it('todos comparten el color de su rama, que se asigna una vez en la punta', () => {
    const commits = [commit('c', ['b']), commit('b', ['a']), commit('a')];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('c'));

    expect(colors(layout)).toEqual([1, 1, 1]);
  });

  it('el primero solo baja y el último solo sube', () => {
    const commits = [commit('b', ['a']), commit('a')];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('b'));

    expect(layout.linksAt(0)).toEqual([{ lane: 0, color: 1, direction: 'down' }]);
    expect(layout.linksAt(1)).toEqual([{ lane: 0, color: 1, direction: 'up' }]);
    expect(layout.passesAt(0)).toEqual([]);
  });

  it('un padre que todavía no está en la página cargada deja la línea bajando', () => {
    const layout = buildGraph(buildCommitRows([commit('b', ['a'])], CLEAN, []), refsAt('b'));

    // Sin la fila de `a`, el tramo hacia abajo sigue ahí: es lo que dice «esto
    // continúa», y es exactamente lo que hay que pintar mientras la página
    // siguiente no llega.
    expect(layout.linksAt(0)).toEqual([{ lane: 0, color: 1, direction: 'down' }]);
  });
});

describe('buildGraph · ramas', () => {
  it('reparte la rama fusionada a su propia calle y devuelve la principal a la 0', () => {
    const layout = buildGraph(buildCommitRows(branchedHistory(), CLEAN, []), refsAt('m3'));

    expect(lanes(layout)).toEqual([0, 0, 1, 1, 0, 0]);
    expect(layout.laneCount).toBe(2);
  });

  it('dos ramas vivas a la vez nunca comparten calle ni color', () => {
    const layout = buildGraph(buildCommitRows(branchedHistory(), CLEAN, []), refsAt('m3'));

    expect(colors(layout)).toEqual([1, 1, 6, 6, 1, 1]);
  });

  it('el color de una rama la acompaña por todo su histórico', () => {
    const layout = buildGraph(buildCommitRows(branchedHistory(), CLEAN, []), refsAt('m3'));

    // `b2` y `b1` son la misma rama y llevan el mismo tono aunque estén en
    // filas distintas; `m1`, mucho más abajo, sigue con el de la principal.
    expect(layout.nodeAt(2).color).toBe(layout.nodeAt(3).color);
    expect(layout.nodeAt(4).color).toBe(layout.nodeAt(0).color);
    expect(layout.nodeAt(2).color).not.toBe(layout.nodeAt(4).color);
  });

  it('la fusión saca un tramo hacia cada padre, cada uno con su color', () => {
    const layout = buildGraph(buildCommitRows(branchedHistory(), CLEAN, []), refsAt('m3'));

    expect(layout.linksAt(1)).toEqual([
      { lane: 0, color: 1, direction: 'up' },
      { lane: 0, color: 1, direction: 'down' },
      { lane: 1, color: 6, direction: 'down' },
    ]);
  });

  it('la calle de la rama cruza de largo las filas de la principal', () => {
    const layout = buildGraph(buildCommitRows(branchedHistory(), CLEAN, []), refsAt('m3'));

    // En la fila de `b2` la que pasa de largo es la principal; en la de `m1`,
    // la de la rama, que todavía no llegó a su punto de partida.
    expect(layout.passesAt(2)).toEqual([{ lane: 0, color: 1 }]);
    expect(layout.passesAt(4)).toEqual([{ lane: 1, color: 6 }]);
  });

  it('el commit raíz recibe las dos calles por arriba y no saca ninguna por abajo', () => {
    const layout = buildGraph(buildCommitRows(branchedHistory(), CLEAN, []), refsAt('m3'));

    expect(layout.linksAt(5)).toEqual([
      { lane: 0, color: 1, direction: 'up' },
      { lane: 1, color: 6, direction: 'up' },
    ]);
    expect(layout.passesAt(5)).toEqual([]);
  });

  it('una calle que quedó libre se reutiliza antes de abrir otra a la derecha', () => {
    // Dos episodios seguidos: el segundo tiene que caer en la calle 1 que dejó
    // el primero, o la columna crecería un carril por cada rama que hubo
    // alguna vez en vez de por cada una que hay a la vez.
    const commits = [
      commit('m4', ['m3', 'x1']),
      commit('x1', ['m2']),
      commit('m3', ['m2']),
      commit('m2', ['m1', 'y1']),
      commit('y1', ['m0']),
      commit('m1', ['m0']),
      commit('m0'),
    ];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('m4'));

    expect(lanes(layout)).toEqual([0, 1, 0, 0, 1, 0, 0]);
    expect(layout.laneCount).toBe(2);
  });

  it('dos hijos del mismo padre convergen en su calle sin duplicarla', () => {
    // `m2` y `b1` cuelgan los dos de `m0`: la segunda arista se engancha a la
    // calle que ya lo esperaba en vez de abrir una tercera.
    const commits = [
      commit('m2', ['m1', 'b1']),
      commit('b1', ['m0']),
      commit('m1', ['m0']),
      commit('m0'),
    ];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('m2'));

    expect(layout.laneCount).toBe(2);
    expect(layout.linksAt(3)).toEqual([
      { lane: 0, color: 1, direction: 'up' },
      { lane: 1, color: 6, direction: 'up' },
    ]);
  });

  it('un padre repetido no dibuja la línea dos veces', () => {
    const commits = [commit('b', ['a', 'a']), commit('a')];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('b'));

    expect(layout.linksAt(0)).toEqual([{ lane: 0, color: 1, direction: 'down' }]);
  });

  it('con más de ocho ramas vivas los tonos se repiten, y ninguno se sale del catálogo', () => {
    // Diez puntas sueltas: ninguna tiene hijos, así que las diez conviven.
    const commits = Array.from({ length: 10 }, (_, index) =>
      commit(`tip${String(index)}`, ['base']),
    );
    const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('tip0'));

    expect(layout.laneCount).toBe(10);
    expect(new Set(colors(layout)).size).toBe(8);

    for (const color of colors(layout)) {
      expect(color).toBeGreaterThanOrEqual(1);
      expect(color).toBeLessThanOrEqual(8);
    }
  });
});

describe('buildGraph · WIP', () => {
  it('el árbol sucio pone el WIP arriba, en la calle y el tono de HEAD', () => {
    const commits = [commit('b', ['a']), commit('a')];
    const layout = buildGraph(buildCommitRows(commits, DIRTY, []), refsAt('b'));

    expect(layout.nodeAt(0)).toEqual({ lane: 0, kind: 'wip', color: 1 });
    expect(lanes(layout)).toEqual([0, 0, 0]);
  });

  it('la línea que sale del WIP conserva el tono de HEAD y marca su estilo', () => {
    const commits = [commit('b', ['a']), commit('a')];
    const layout = buildGraph(buildCommitRows(commits, DIRTY, []), refsAt('b'));

    expect(layout.linksAt(0)).toEqual([{ lane: 0, color: 1, direction: 'down', kind: 'wip' }]);
    // El commit de HEAD hereda el color de rama, restaurado al llegar.
    expect(layout.nodeAt(1).color).toBe(1);
  });

  it('la llegada WIP conserva su tipo hasta HEAD y convive con llegadas y salidas de rama normales', async () => {
    const rows = buildCommitRows(branchedHistory(), DIRTY, []);
    const refs = refsAt('m1');
    const layouts = [buildGraph(rows, refs), await buildGraphAsync(rows, refs)];
    const headIndex = rows.findIndex((row) => row.kind === 'commit' && row.commit.sha === 'm1');

    for (const layout of layouts) {
      expect(layout.nodeAt(headIndex)).toEqual({ lane: 0, color: 1, kind: 'commit' });
      expect(layout.linksAt(headIndex)).toEqual([
        { lane: 0, color: 1, direction: 'up', kind: 'wip' },
        { lane: 1, color: 6, direction: 'up' },
        { lane: 0, color: 1, direction: 'down' },
      ]);
      expect(layout.passesAt(headIndex)).toEqual([{ lane: 2, color: 3 }]);
      expect(
        [...layout.linksAt(headIndex + 1), ...layout.passesAt(headIndex + 1)].every(
          ({ kind }) => kind !== 'wip',
        ),
      ).toBe(true);
    }
    for (let index = 0; index < rows.length; index++) {
      expect(layouts[1]!.nodeAt(index)).toEqual(layouts[0]!.nodeAt(index));
      expect(layouts[1]!.passesAt(index)).toEqual(layouts[0]!.passesAt(index));
      expect(layouts[1]!.linksAt(index)).toEqual(layouts[0]!.linksAt(index));
    }
  });

  it('con el árbol limpio no hay nodo WIP', () => {
    const commits = [commit('b', ['a']), commit('a')];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, []), refsAt('b'));

    expect(layout.rowCount).toBe(2);
    expect(layout.nodeAt(0).kind).toBe('commit');
  });

  it('WIP conserva su vertical y agrupa los stashes del mismo origen en una derivación', () => {
    const commits = [commit('a', ['b']), commit('b', ['c']), commit('c')];
    const stashes = [
      stash(0, 'stash-b-1', 'b'),
      stash(1, 'stash-b-2', 'b'),
      stash(2, 'stash-b-3', 'b'),
    ];
    const layout = buildGraph(buildCommitRows(commits, DIRTY, stashes), refsAt('a', stashes));
    const wipLane = layout.nodeAt(0).lane;
    const stashLanes = [layout.nodeAt(1).lane, layout.nodeAt(2).lane, layout.nodeAt(3).lane];
    const headLane = layout.nodeAt(4).lane;
    const stashOriginLane = layout.nodeAt(5).lane;

    expect(wipLane).toBe(headLane);
    expect(stashOriginLane).toBe(wipLane);
    expect(new Set(stashLanes).size).toBe(1);
    expect(stashLanes[0]).not.toBe(wipLane);
    expect(layout.linksAt(0)).toContainEqual({
      lane: headLane,
      color: layout.nodeAt(4).color,
      direction: 'down',
      kind: 'wip',
    });
    expect(layout.linksAt(5).filter((link) => link.kind === 'stash')).toEqual(
      Array.from({ length: 1 }, () => ({
        lane: stashLanes[0],
        color: layout.nodeAt(5).color,
        direction: 'up' as const,
        kind: 'stash' as const,
      })),
    );
  });
});

describe('buildGraph · guardados', () => {
  it('reutilizar una calle no cambia el color ni el origen de un stash anterior', () => {
    const commits = [commit('a'), commit('b')];
    const rows = [
      { kind: 'stash' as const, key: 'stash:0', stash: stash(0, 's-a', 'a') },
      { kind: 'commit' as const, key: 'a', commit: commits[0]! },
      { kind: 'stash' as const, key: 'stash:1', stash: stash(1, 's-b', 'b') },
      { kind: 'commit' as const, key: 'b', commit: commits[1]! },
    ];
    const layout = buildGraph(rows, refsAt('a'));

    expect(layout.nodeAt(0).lane).toBe(layout.nodeAt(2).lane);
    expect(layout.nodeAt(0).color).toBe(layout.nodeAt(1).color);
    expect(layout.nodeAt(2).color).toBe(layout.nodeAt(3).color);
    expect(layout.nodeAt(0).color).not.toBe(layout.nodeAt(2).color);
    expect(layout.linksAt(1)).toContainEqual({
      lane: layout.nodeAt(0).lane,
      color: layout.nodeAt(0).color,
      direction: 'up',
      kind: 'stash',
    });
  });

  it('muchos stashes del mismo origen ocupan una sola derivación y no ensanchan el grafo', () => {
    const commits = [commit('head', ['base']), commit('base')];
    const stashes = Array.from({ length: 30 }, (_, index) =>
      stash(index, `s-${String(index)}`, 'base'),
    );
    const layout = buildGraph(buildCommitRows(commits, DIRTY, stashes), refsAt('head', stashes));

    expect(layout.laneCount).toBe(2);
    for (let row = 2; row <= stashes.length; row += 1) {
      expect(layout.linksAt(row)).toContainEqual({
        lane: 1,
        color: 1,
        direction: 'up',
        kind: 'stash',
      });
      expect(layout.passesAt(row)).toEqual([{ lane: 0, color: 1, kind: 'wip' }]);
    }
  });

  it('los guardados usan una derivación propia y se bifurcan en su commit de origen', () => {
    const commits = [commit('a', ['b']), commit('b')];
    const stashes = [stash(0, 'stash-a', 'a')];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, stashes), refsAt('a', stashes));

    // Orden de filas: stash@0, commit a, commit b
    expect(layout.nodeAt(0)).toEqual({ lane: 1, kind: 'stash', color: 1 });
    expect(layout.linksAt(0)).toEqual([{ lane: 1, color: 1, direction: 'down', kind: 'stash' }]);
    expect(layout.nodeAt(0).lane).not.toBe(layout.nodeAt(1).lane);
    // En la base, la línea punteada llega por su calle y gira hacia el commit.
    expect(layout.linksAt(1)).toContainEqual({
      lane: layout.nodeAt(0).lane,
      color: layout.nodeAt(1).color,
      direction: 'up',
      kind: 'stash',
    });
  });

  it('dos guardados del mismo commit se apilan en su misma vertical', () => {
    const commits = [commit('a', ['b']), commit('b')];
    const stashes = [stash(0, 'stash-a', 'a'), stash(1, 'stash-b', 'a')];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, stashes), refsAt('a', stashes));

    // Filas: stash@0, stash@1, commit a, commit b
    expect(layout.nodeAt(0).kind).toBe('stash');
    expect(layout.nodeAt(1).kind).toBe('stash');
    expect(layout.nodeAt(0).lane).toBe(layout.nodeAt(1).lane);
    expect(layout.nodeAt(0).lane).not.toBe(layout.nodeAt(2).lane);
  });

  it('cada guardado conserva una derivación separada aunque nazcan de ramas distintas', () => {
    const commits = branchedHistory();
    const stashes = [stash(0, 'stash-main', 'm3'), stash(1, 'stash-branch', 'b2')];
    const rows = buildCommitRows(commits, CLEAN, stashes);
    const layout = buildGraph(rows, refsAt('m3', stashes));
    const mainOrigin = rows.findIndex((row) => row.kind === 'commit' && row.commit.sha === 'm3');
    const branchOrigin = rows.findIndex((row) => row.kind === 'commit' && row.commit.sha === 'b2');

    expect(layout.nodeAt(0).lane).not.toBe(layout.nodeAt(mainOrigin).lane);
    expect(layout.nodeAt(1).lane).not.toBe(layout.nodeAt(branchOrigin).lane);
    expect(layout.nodeAt(0).lane).not.toBe(layout.nodeAt(1).lane);
  });

  it('la calle de un guardado se suelta al encontrar su commit de origen', () => {
    const commits = [commit('a', ['b']), commit('b', ['c']), commit('c')];
    const stashes = [stash(0, 'stash-a', 'a')];
    const layout = buildGraph(buildCommitRows(commits, CLEAN, stashes), refsAt('a', stashes));

    // Después del commit de origen ya no cruza nada de stash
    const passesAfter = layout.passesAt(3); // commit b
    const stashPasses = passesAfter.filter((pass) => pass.kind === 'stash');

    expect(stashPasses).toHaveLength(0);
  });
});

describe('buildGraph · los bordes', () => {
  it('sin filas no hay nada que repartir', () => {
    const layout = buildGraph([], refsAt(''));

    expect(layout.rowCount).toBe(0);
    expect(layout.laneCount).toBe(0);
  });

  it('una fila que no existe no devuelve tramos ni revienta', () => {
    const layout = buildGraph(buildCommitRows([commit('a')], CLEAN, []), refsAt('a'));

    expect(layout.passesAt(9)).toEqual([]);
    expect(layout.linksAt(9)).toEqual([]);
  });
});

/*
 * La verificación de la fase, y la razón de que `graph.ts` sea puro: cien mil
 * commits se reparten sin montar nada y sin tocar el DOM.
 *
 * El margen es amplio a propósito. Lo que la prueba tiene que detectar no es un
 * milisegundo de más sino un cambio de orden de crecimiento —un recorrido por
 * fila dentro del recorrido de filas—, que en esta escala no se pasa de dos
 * segundos: se pasa de un minuto.
 */
describe('rendimiento', () => {
  it('el cálculo por bloques conserva cada nodo, enlace y stash del grafo sincrónico', async () => {
    const { history, refs, status } = buildLargeRepo({ commitCount: 1_000, branchCount: 8 });
    const rows = buildCommitRows(history.commits, status, refs.stashes);
    const expected = buildGraph(rows, refs);
    const actual = await buildGraphAsync(rows, refs);
    expect(actual.laneCount).toBe(expected.laneCount);
    expect(actual.rowCount).toBe(expected.rowCount);
    for (let index = 0; index < rows.length; index++) {
      expect(actual.nodeAt(index)).toEqual(expected.nodeAt(index));
      expect(actual.passesAt(index)).toEqual(expected.passesAt(index));
      expect(actual.linksAt(index)).toEqual(expected.linksAt(index));
    }
  });

  it('reparte las calles de cien mil commits sin montar nada', () => {
    const { history, status, refs } = buildLargeRepo({ commitCount: 100_000, branchCount: 8 });
    const rows = buildCommitRows(history.commits, status, refs.stashes);

    const start = performance.now();
    const layout = buildGraph(rows, refs);
    const elapsed = performance.now() - start;

    expect(layout.rowCount).toBe(rows.length);
    // Una historia con ramas y fusiones tiene que producir calles de verdad, o
    // la medición estaría cronometrando un recorrido en línea recta.
    expect(layout.laneCount).toBeGreaterThan(1);
    expect(elapsed).toBeLessThan(2000);
  });

  it('pintar una ventana de filas no depende de cuántas haya', () => {
    const { history, status, refs } = buildLargeRepo({ commitCount: 100_000, branchCount: 8 });
    const layout = buildGraph(buildCommitRows(history.commits, status, refs.stashes), refs);

    // Lo que `CommitGraph` pide por fotograma: unas cuantas decenas de filas.
    const start = performance.now();

    for (let row = 50_000; row < 50_060; row += 1) {
      layout.nodeAt(row);
      layout.passesAt(row);
      layout.linksAt(row);
    }

    expect(performance.now() - start).toBeLessThan(50);
  });
});
