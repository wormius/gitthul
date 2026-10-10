import { describe, expect, it } from 'vitest';

import type { Commit, Person } from '@core/domain/commit';
import type { Branch, RefsSnapshot } from '@core/domain/refs';
import type { RepoSummary } from '@core/domain/repository';

import {
  activityDays,
  contributors,
  headBranch,
  mergeRecentCommits,
  refCounts,
  statsSince,
  STATS_MONTHS,
  usageDays,
} from './stats';

/*
 * Los agregados se prueban sin montar nada, que es la razón de que vivan fuera
 * de React: contar commits por día o agrupar autores no necesita un DOM.
 */

const ADA: Person = { name: 'Ada Márquez', email: 'ada@ejemplo.org' };
const BRUNO: Person = { name: 'Bruno Salas', email: 'bruno@ejemplo.org' };

/** Un commit del día y la hora locales que se le pidan. */
function commitAt(at: number, author: Person = ADA, sha = String(at)): Commit {
  return {
    sha,
    parents: [],
    summary: `commit ${sha}`,
    body: '',
    author,
    authoredAt: at,
    committer: author,
    committedAt: at,
  };
}

function local(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour).getTime();
}

function repo(id: string): RepoSummary {
  return { id, name: id, path: `/tmp/${id}`, head: 'main', lastOpenedAt: null };
}

function branch(name: string, extra: Partial<Branch> = {}): Branch {
  return {
    id: `refs/heads/${name}`,
    name,
    kind: 'local',
    tip: 'aaa',
    ahead: 0,
    behind: 0,
    isHead: false,
    ...extra,
  };
}

describe('statsSince', () => {
  it('retrocede doce meses hasta el primero del mes, a medianoche', () => {
    const since = new Date(statsSince(local(2026, 7, 27, 18)));

    expect(since.getFullYear()).toBe(2025);
    // Julio de 2026 hacia atrás, doce meses contados incluyendo el actual.
    expect(since.getMonth()).toBe(7);
    expect(since.getDate()).toBe(1);
    expect(since.getHours()).toBe(0);
  });

  // Anclarla al primero del mes es lo que impide que dos consultas del mismo
  // día traigan conjuntos distintos y el total baile sin que nadie toque nada.
  it('no se mueve dentro del mismo mes', () => {
    expect(statsSince(local(2026, 7, 1, 0))).toBe(statsSince(local(2026, 7, 31, 23)));
  });

  it('cubre exactamente los meses que promete', () => {
    const from = new Date(statsSince(local(2026, 1, 15)));

    expect(from.getFullYear() * 12 + from.getMonth()).toBe(2026 * 12 + 0 - (STATS_MONTHS - 1));
  });
});

describe('activityDays', () => {
  it('cuenta los commits de cada día del calendario de quien mira', () => {
    const days = activityDays([
      commitAt(local(2026, 3, 2, 9), ADA, 'a'),
      commitAt(local(2026, 3, 2, 23), ADA, 'b'),
      commitAt(local(2026, 3, 5, 10), BRUNO, 'c'),
    ]);

    expect([...days].sort((left, right) => left.date.localeCompare(right.date))).toEqual([
      { date: '2026-03-02', value: 2 },
      { date: '2026-03-05', value: 1 },
    ]);
  });

  it('sin commits no inventa ningún día', () => {
    expect(activityDays([])).toEqual([]);
  });
});

describe('usageDays', () => {
  it('recorta a la ventana que la cuadrícula enseña', () => {
    const usage = { '2024-12-31': 3, '2025-08-01': 1, '2026-07-27': 4 };

    expect(usageDays(usage, '2025-08-01')).toEqual([
      { date: '2025-08-01', value: 1 },
      { date: '2026-07-27', value: 4 },
    ]);
  });

  it('sin límite devuelve todo lo guardado', () => {
    expect(usageDays({ '2024-01-01': 2 })).toEqual([{ date: '2024-01-01', value: 2 }]);
  });
});

describe('contributors', () => {
  it('agrupa por correo y ordena de más a menos', () => {
    const commits = [
      commitAt(1, ADA, 'a'),
      commitAt(2, BRUNO, 'b'),
      commitAt(3, ADA, 'c'),
      commitAt(4, ADA, 'd'),
    ];

    expect(contributors(commits)).toEqual([
      { person: ADA, commits: 3 },
      { person: BRUNO, commits: 1 },
    ]);
  });

  // La misma persona firma como «Ada Márquez» o como «ada» según la máquina;
  // contarla dos veces convertiría el bloque en una lista de configuraciones.
  it('la misma dirección con otro nombre sigue siendo la misma persona', () => {
    const otra: Person = { name: 'ada', email: 'ADA@ejemplo.org' };
    const [first, ...rest] = contributors([commitAt(1, ADA, 'a'), commitAt(2, otra, 'b')]);

    expect(rest).toEqual([]);
    expect(first?.commits).toBe(2);
  });

  it('respeta el tope que se le dé', () => {
    const many = Array.from({ length: 20 }, (_, index) =>
      commitAt(
        index,
        { name: `p${String(index)}`, email: `p${String(index)}@ejemplo.org` },
        `s${String(index)}`,
      ),
    );

    expect(contributors(many)).toHaveLength(8);
    expect(contributors(many, 3)).toHaveLength(3);
  });
});

describe('mergeRecentCommits', () => {
  it('mezcla por fecha y cada commit se queda con su repositorio', () => {
    const uno = repo('uno');
    const dos = repo('dos');

    const merged = mergeRecentCommits([
      { repo: uno, commits: [commitAt(30, ADA, 'a'), commitAt(10, ADA, 'b')] },
      { repo: dos, commits: [commitAt(20, BRUNO, 'c')] },
    ]);

    expect(merged.map((entry) => [entry.repo.id, entry.commit.sha])).toEqual([
      ['uno', 'a'],
      ['dos', 'c'],
      ['uno', 'b'],
    ]);
  });

  // Un worktree comparte la historia de su padre: sin descartar los SHA
  // repetidos, la pantalla de inicio saldría duplicada de arriba abajo.
  it('un mismo commit en dos repositorios aparece una sola vez', () => {
    const padre = repo('gitthul');
    const arbol = repo('gitthul-worktree');
    const commits = [commitAt(30, ADA, 'a'), commitAt(20, ADA, 'b')];

    const merged = mergeRecentCommits([
      { repo: padre, commits },
      { repo: arbol, commits },
    ]);

    expect(merged.map((entry) => [entry.repo.id, entry.commit.sha])).toEqual([
      ['gitthul', 'a'],
      ['gitthul', 'b'],
    ]);
  });

  it('se queda con los diez más recientes', () => {
    const uno = repo('uno');
    const commits = Array.from({ length: 25 }, (_, index) =>
      commitAt(index, ADA, `s${String(index)}`),
    );

    const merged = mergeRecentCommits([{ repo: uno, commits }]);

    expect(merged).toHaveLength(10);
    expect(merged[0]?.commit.sha).toBe('s24');
  });
});

describe('refCounts y headBranch', () => {
  const refs: RefsSnapshot = {
    head: { branch: 'dev', sha: 'bbb', detached: false },
    branches: [
      branch('main', { isHead: true }),
      branch('dev', { upstream: 'origin/dev', ahead: 2, behind: 1 }),
      { ...branch('origin/dev'), kind: 'remote', remote: 'origin' },
    ],
    tags: [{ id: 'refs/tags/v1', name: 'v1', target: 'aaa', annotated: false }],
    stashes: [],
    worktrees: [
      {
        path: '/tmp/uno',
        name: 'uno',
        branch: 'main',
        head: 'aaa',
        isMain: true,
        locked: false,
        missing: false,
      },
    ],
    remotes: [],
  };

  it('cuenta locales y remotas por separado', () => {
    expect(refCounts(refs)).toEqual({
      localBranches: 2,
      remoteBranches: 1,
      tags: 1,
      stashes: 0,
      worktrees: 1,
    });
  });

  /*
   * `isHead` marca la activa del repositorio principal, y en un worktree esa es
   * otra rama: el adelanto que hay que enseñar es el de la suya, así que se
   * busca por el nombre que da `refs.head`.
   */
  it('sigue a HEAD y no a la marca del repositorio principal', () => {
    expect(headBranch(refs)?.name).toBe('dev');
  });

  it('con HEAD desacoplado no hay rama que nombrar', () => {
    expect(
      headBranch({ ...refs, head: { branch: null, sha: 'ccc', detached: true } }),
    ).toBeUndefined();
  });
});
