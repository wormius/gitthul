import type { Sha } from '@core/domain/commit';
import type { Branch, RefsSnapshot } from '@core/domain/refs';
import type { RepoId } from '@core/domain/repository';

import { buildHistory, type History } from './history';
import { mutableState, type MockRepo, type MockWorld } from './world';

/**
 * El mundo grande, solo para medir.
 *
 * El mundo de siempre tiene trescientos y pico commits porque es el que hay que
 * mirar con los ojos: cuatro repositorios reconocibles, con sus conflictos y sus
 * guardados. Para el motor del grafo y para la tabla virtualizada eso no prueba
 * nada — el plan pide medirlas contra cientos de miles de filas—, y engordar el
 * mundo de siempre para lograrlo haría lento cada arranque de la aplicación y
 * cada prueba que lo toca.
 *
 * Así que convive con él: misma semilla, misma historia, mismo generador
 * (`buildHistory`), y ningún consumidor fuera de las pruebas de rendimiento.
 */

export const LARGE_REPO_ID: RepoId = 'monorepo';

const LARGE_PATH = '/home/example/projects/monorepo';
const LARGE_SEED = 20260810;
/** El primero de la historia grande, fijo por la misma razón que el del mundo normal. */
const FIRST_COMMIT_AT = Date.UTC(2018, 0, 8, 8, 30);

export interface LargeWorldSpec {
  /**
   * Cuántos commits, aproximadamente.
   *
   * El generador trabaja por episodios —rama, avance, fusión— y termina el que
   * tenga a medias, así que puede pasarse por unos pocos. Quien mida no necesita
   * la cifra exacta, necesita el orden de magnitud y que no cambie entre dos
   * ejecuciones.
   */
  commitCount: number;
  /** Ramas vivas, sin fusionar. Son las calles que el grafo tiene que repartir. */
  branchCount: number;
  seed?: number;
}

/** Nombres deterministas y distintos entre sí, que es todo lo que se les pide. */
function branchNames(count: number): readonly string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => `feature/${String(index + 1)}`);
}

export function buildLargeHistory(spec: LargeWorldSpec): History {
  return buildHistory({
    seed: spec.seed ?? LARGE_SEED,
    target: spec.commitCount,
    mainBranch: 'main',
    openBranches: branchNames(spec.branchCount),
    stashCount: 2,
    startAt: FIRST_COMMIT_AT,
  });
}

/**
 * Las referencias de la historia grande.
 *
 * No reutiliza `branchesFrom` del mundo normal a propósito: aquel cuenta lo de
 * más y lo de menos recorriendo el grafo entero por cada rama, que con veinte
 * ramas y cien mil commits es un recorrido de dos millones de pasos antes de
 * empezar a medir nada. Aquí las ramas nacen al día con su remoto salvo la
 * principal, que es el único caso que las pruebas de rendimiento necesitan
 * distinguir.
 */
function refsOf(history: History): RefsSnapshot {
  const head = history.tips.get('main') ?? '';
  const branches: Branch[] = [];

  for (const [name, tip] of history.tips) {
    const remoteTip: Sha = history.remoteTips.get(name) ?? tip;

    branches.push({
      id: `refs/heads/${name}`,
      name,
      kind: 'local',
      tip,
      upstream: `origin/${name}`,
      ahead: 0,
      behind: 0,
      isHead: name === 'main',
    });

    branches.push({
      id: `refs/remotes/origin/${name}`,
      name: `origin/${name}`,
      kind: 'remote',
      remote: 'origin',
      tip: remoteTip,
      ahead: 0,
      behind: 0,
      isHead: false,
    });
  }

  const remotes = [
    {
      name: 'origin',
      fetchUrl: 'https://ejemplo.org/alex/monorepo.git',
      pushUrl: 'https://ejemplo.org/alex/monorepo.git',
    },
  ];

  return {
    head: { branch: 'main', sha: head, detached: false },
    branches,
    tags: [],
    stashes: history.stashes.map((stash, index) => ({ index, ...stash })),
    worktrees: [
      {
        path: LARGE_PATH,
        name: LARGE_REPO_ID,
        branch: 'main',
        head,
        isMain: true,
        locked: false,
        missing: false,
      },
    ],
    remotes,
  };
}

export function buildLargeRepo(spec: LargeWorldSpec): MockRepo {
  const history = buildLargeHistory(spec);
  const refs = refsOf(history);
  const status = { staged: [], unstaged: [], conflicted: [], clean: true };

  return {
    repository: {
      id: LARGE_REPO_ID,
      name: LARGE_REPO_ID,
      path: LARGE_PATH,
      head: 'main',
      lastOpenedAt: null,
      remotes: refs.remotes,
      operation: { kind: 'none' },
      bare: false,
      hasSubmodules: false,
    },
    history,
    refs,
    status,
    conflicts: new Map(),
    ...mutableState(status),
  };
}

/** El repositorio grande, envuelto como mundo para quien espera uno. */
export function buildLargeWorld(spec: LargeWorldSpec): MockWorld {
  return {
    repos: new Map([[LARGE_REPO_ID, buildLargeRepo(spec)]]),
    order: [LARGE_REPO_ID],
  };
}
