/** El repositorio, visto desde fuera. */

import type { Sha } from './commit';
import type { Remote } from './refs';

export type RepoId = string;

/**
 * Operación de git a medias.
 *
 * Es lo que decide si la vista Resolver toma el control y lo que da nombre a
 * «abortar»: no se aborta «la operación», se aborta la fusión de `dev` dentro
 * de `main`. Deja de ser una cadena justamente por eso: el panel de
 * estadísticas de Repositorios lleva desde F1.4 sin poder decir entre qué dos
 * ramas se quedó a medias, y la invariante 5 exige nombrarlas.
 *
 * `bisect` no lleva extremos porque no los tiene: se busca dentro de una
 * historia, no se trae una rama hacia otra.
 */
export type RepoOperation =
  | { kind: 'none' }
  | {
      kind: 'merge' | 'rebase' | 'cherryPick' | 'revert';
      source: string;
      target: string;
      sha?: Sha;
    }
  | { kind: 'bisect' };

/**
 * Qué hizo el pull y por qué lo hizo así.
 *
 * El clic izquierdo no pregunta: el puerto mira si lo local ya estaba
 * publicado y elige rebase o merge por su cuenta. Lo que no puede hacer es
 * callárselo, porque quien se encuentra la rama reescrita tiene derecho a
 * saber quién lo decidió; la barra de estado repite este dato tal cual y no
 * vuelve a razonarlo por su cuenta.
 */
export interface PullResult {
  strategy: 'rebase' | 'merge';
  reason: 'unpublished' | 'published';
  received: number;
}

/**
 * Una entrada de la pila de deshacer.
 *
 * Viaja como clave de i18n más parámetros y nunca como frase ya traducida: la
 * pila sobrevive a un cambio de idioma en caliente, y una lista de acciones
 * escritas la mitad en alemán sería el ejemplo más visible de romper esa regla.
 * `undoable` existe porque el reflog de verdad tiene entradas que se pueden
 * leer y no rehacer —lo que ya se podó, lo que otro proceso escribió—, y la
 * lista las enseña igual en vez de fingir que no pasaron.
 */
export interface UndoEntry {
  id: string;
  /** Clave de i18n más parámetros: nunca texto ya traducido. */
  labelKey: string;
  params: Readonly<Record<string, string | number>>;
  at: number;
  undoable: boolean;
}

/** Una posición anterior de HEAD que Git conserva en su historial local. */
export interface ReflogEntry {
  /** Selector que se revalida al recuperar, por ejemplo `HEAD@{3}`. */
  selector: string;
  sha: Sha;
  at: number;
  summary: string;
}

/**
 * El avance de lo que viaja por la red.
 *
 * Es el `CloneProgress` de F0.8 con las fases que le faltaban: comprimir, que
 * es lo que ocupa el push, y recibir, que es lo que ocupa el fetch. `total` en
 * `null` mientras el remoto no diga cuánto falta, que es cuando la barra va
 * indeterminada.
 */
export interface TransferProgress {
  phase: 'counting' | 'compressing' | 'sending' | 'receiving' | 'resolving' | 'checkout';
  received: number;
  total: number | null;
}

/** Lo mínimo para pintar una fila en Repositorios, sin abrir nada. */
export interface RepoSummary {
  id: RepoId;
  name: string;
  path: string;
  /** Rama activa, o el SHA corto cuando HEAD está desacoplado. */
  head: string;
  /** Milisegundos, o `null` si nunca se abrió desde GitThul. */
  lastOpenedAt: number | null;
  /** Repositorio padre cuando esta entrada es un worktree suyo. */
  worktreeOf?: RepoId;
}

export interface Repository extends RepoSummary {
  remotes: readonly Remote[];
  operation: RepoOperation;
  /** Sin árbol de trabajo: no hay nada que preparar ni que resolver. */
  bare: boolean;
  /** El repositorio tiene submódulos; en la v1 se detectan sin estorbar. */
  hasSubmodules: boolean;
}
