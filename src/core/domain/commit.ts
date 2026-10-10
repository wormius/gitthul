/** Commits y quién los firma. */

import type { CommitPrecondition, FileChange } from './status';

/** SHA-1 completo, en minúsculas. El corto se calcula al pintar, nunca se guarda. */
export type Sha = string;

/** Rama y punta exactas visibles al confirmar una secuencia sobre el historial. */
export interface CommitSequencePrecondition {
  targetRef: string;
  targetOid: Sha;
}

export interface Person {
  name: string;
  email: string;
}

export interface Commit {
  sha: Sha;
  /**
   * Padres en orden. El primero es la línea que continúa; los demás son lo que
   * se fusionó. Vacío solo en el commit raíz.
   */
  parents: readonly Sha[];
  /** Primera línea del mensaje, la que la tabla enseña. */
  summary: string;
  /** El resto del mensaje, sin la línea en blanco de separación. */
  body: string;
  author: Person;
  /** Milisegundos desde la época, UTC. La zona la pone quien pinta. */
  authoredAt: number;
  committer: Person;
  committedAt: number;
}

/** El commit con lo que solo se pide al seleccionarlo. */
export interface CommitDetails {
  commit: Commit;
  /** Archivos que cambió respecto de su primer padre. */
  files: readonly FileChange[];
  /** Ramas y tags que apuntan justo a este commit, por nombre. */
  refs: readonly string[];
}

/**
 * Lo que hace falta para escribir un commit.
 *
 * Resumen y cuerpo viajan aparte porque son dos campos distintos en el
 * compositor y dos cosas distintas en git: la primera línea es la que la tabla
 * enseña. `amend` rehace el último commit en vez de encadenar otro.
 */
export interface CommitRequest {
  summary: string;
  body: string;
  amend?: boolean;
  /** En amend, cambia solo el mensaje y conserva el índice preparado. */
  amendMessageOnly?: boolean;
  /** Perfil elegido; sin él, el de `git config`. */
  author?: Person;
  /** HEAD e índice que estaban a la vista al pulsar el botón. */
  precondition?: CommitPrecondition;
}

export interface CommitPageRequest {
  /** Search pages skip the full graph count; total is a lower bound. */
  search?: {
    field: 'messages' | 'authors' | 'shas';
    text: string;
    scanSkip?: number;
    scanLimit?: number;
  };
  /** Desde dónde recorrer: nombre de rama, tag o SHA. Sin él, todas las refs. */
  start?: string;
  /**
   * Milisegundos: no recorrer más atrás de esta fecha.
   *
   * Existe por las estadísticas de Repositorios, que solo miran doce meses. Sin
   * él, un repositorio de cien mil commits costaría cien mil commits para pintar
   * un heatmap de un año, y con él cuesta lo mismo que uno de trescientos. El
   * `total` que devuelve la página es entonces el del periodo, no el absoluto:
   * quien quiera la cifra completa pide la página sin `since`.
   */
  since?: number;
  skip?: number;
  limit?: number;
}

export interface CommitPage {
  commits: readonly Commit[];
  /** Total del recorrido; con search es una cota inferior y hasMore indica si queda otra página. */
  total: number;
  hasMore: boolean;
  /** Cursor of bounded search scans, including nonmatching commits. */
  searchCursor?: number;
}

export function isMerge(commit: Commit): boolean {
  return commit.parents.length > 1;
}

export function shortSha(sha: Sha, length = 7): string {
  return sha.slice(0, length);
}
