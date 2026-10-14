/** Todo lo que apunta a un commit: ramas, tags, stashes y worktrees. */

import type { Commit, Person, Sha } from './commit';

export interface Remote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface Branch {
  /** Referencia completa: `refs/heads/dev`, `refs/remotes/origin/dev`. */
  id: string;
  /** Como se enseña y como se nombra en toda frase: `dev`, `origin/dev`. */
  name: string;
  kind: 'local' | 'remote';
  /** Solo en las remotas. */
  remote?: string;
  tip: Sha;
  /** Rama remota que sigue esta local, por nombre completo. */
  upstream?: string;
  /** Tiene seguimiento configurado, pero su referencia ya no existe. */
  upstreamMissing?: boolean;
  /** Commits respecto de `upstream`; no disponibles si `upstreamMissing` es true. */
  ahead: number;
  behind: number;
  /** La rama activa del repositorio principal. */
  isHead: boolean;
  /** Ruta del worktree que la tiene tomada, si no es el principal. */
  checkedOutIn?: string;
}

export interface Tag {
  id: string;
  name: string;
  target: Sha;
  /** Anotado: lleva mensaje y quien lo puso; el ligero es solo un puntero. */
  annotated: boolean;
  message?: string;
  tagger?: Person;
  taggedAt?: number;
}

export interface Stash {
  /** Posición en la pila: `stash@{0}` es el más reciente. */
  index: number;
  sha: Sha;
  /** Primer padre del commit stash: el commit desde el que nació. */
  base: Sha;
  message: string;
  /** Rama sobre la que se guardó. Las acciones la nombran. */
  branch: string;
  createdAt: number;
  /** Cuántos archivos lleva dentro, para el resumen sin abrirlo. */
  fileCount: number;
}

/** Nombre legible para las acciones, también si el mensaje está vacío. */
export function stashName(stash: Pick<Stash, 'message'>): string {
  const message = stash.message.trim();
  return message ? `stash ${message}` : 'stash';
}

export interface Worktree {
  /** La ruta es la identidad: no hay dos worktrees en la misma carpeta. */
  path: string;
  name: string;
  branch: string;
  head: Sha;
  /** El worktree principal es la carpeta del propio repositorio. */
  isMain: boolean;
  locked: boolean;
  /** El repositorio ya no está en esa ruta: se movió o se borró. */
  missing: boolean;
}

/**
 * A dónde apunta HEAD.
 *
 * `branch` es `null` con HEAD desacoplado, que es un estado real y frecuente
 * —revisar un tag, quedarse a mitad de un rebase— y la interfaz tiene que
 * decirlo con esas palabras en vez de inventar una rama.
 */
export interface Head {
  branch: string | null;
  sha: Sha;
  detached: boolean;
}

/** Una foto completa de las referencias, que es lo que pinta el panel izquierdo. */
export interface RefsSnapshot {
  head: Head;
  branches: readonly Branch[];
  tags: readonly Tag[];
  stashes: readonly Stash[];
  worktrees: readonly Worktree[];
  remotes: readonly Remote[];
}

/**
 * A dónde apunta una escritura que acepta rama, tag o commit suelto.
 *
 * Va discriminado y no como cadena porque `v1.0` puede ser las tres cosas a la
 * vez, y quien lo pide siempre sabe cuál eligió: sale de una fila de rama, de
 * una de tag o de un commit del grafo. Resolver la ambigüedad en el puerto
 * sería adivinar lo que la vista ya sabía.
 */
export type RefTarget =
  | { kind: 'branch'; name: string }
  | { kind: 'remoteBranch'; name: string; remote: string }
  | { kind: 'tag'; name: string }
  | { kind: 'commit'; sha: Sha };

/**
 * Hasta dónde deshace un `reset` lo que ya estaba escrito.
 *
 * Los tres modos mueven la rama; lo que los distingue es qué se llevan por
 * delante. `soft` deja el stage y el árbol intactos, `mixed` desprepara y
 * `hard` borra también lo que no estaba en ningún commit — que es el único de
 * los tres del que no se vuelve, y por eso el diálogo que lo ofrece tiene que
 * decirlo con esas palabras.
 */
export type ResetMode = 'soft' | 'mixed' | 'hard';

/** Puntas exactas que la vista previa enseñó antes de permitir una integración. */
export interface IntegrationPrecondition {
  sourceRef: string;
  targetRef: string;
  sourceOid: Sha;
  targetOid: Sha;
}

/**
 * Lo que la vista previa de soltar una rama sobre otra pinta en palabras.
 *
 * Es la promesa de la invariante 5 llevada al arrastre: antes de fusionar nada
 * se enseña qué se trae, desde dónde y hacia dónde, con los dos nombres
 * escritos. `source` y `target` siempre en la dirección del gesto —soltar A
 * sobre B es traer A hacia B—, así que quien pinta no tiene que adivinar cuál
 * es cuál.
 */
export interface IntegrationPreview {
  kind: 'merge' | 'rebase';
  source: string;
  target: string;
  commits: readonly Commit[];
  fastForward: boolean;
  /** `null` cuando no se puede saber sin intentarlo: la vista previa no dice nada al respecto. */
  conflicts: readonly string[] | null;
  precondition: IntegrationPrecondition;
}

export function localBranches(snapshot: RefsSnapshot): readonly Branch[] {
  return snapshot.branches.filter((branch) => branch.kind === 'local');
}

/** Ramas y tags que apuntan a un commit, por nombre. Es la etiqueta del grafo. */
export function refsAt(snapshot: RefsSnapshot, sha: Sha): readonly string[] {
  return [
    ...snapshot.branches.filter((branch) => branch.tip === sha).map((branch) => branch.name),
    ...snapshot.tags.filter((tag) => tag.target === sha).map((tag) => tag.name),
  ];
}
