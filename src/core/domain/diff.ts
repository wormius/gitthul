/** Diffs: lo que come el visor de F2.6 y la revisión de Resolver. */

import type { Sha } from './commit';
import type { ChangeType } from './status';

export type DiffLineKind = 'context' | 'added' | 'removed';

/** Tramo resaltado dentro de la línea, en índices de `text`. */
export interface WordSpan {
  start: number;
  end: number;
}

export interface DiffLine {
  kind: DiffLineKind;
  /** Número de línea en la versión anterior; `null` en las añadidas. */
  oldLine: number | null;
  /** Número de línea en la versión nueva; `null` en las borradas. */
  newLine: number | null;
  text: string;
  /** Resaltado por palabra. Vacío cuando la línea cambió entera. */
  words?: readonly WordSpan[];
}

export interface Hunk {
  /** Estable dentro del archivo: es lo que se prepara y se retira por hunk. */
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** El contexto que git escribe tras las arrobas, si lo hay. */
  header: string;
  lines: readonly DiffLine[];
}

export interface TextDiff {
  kind: 'text';
  hunks: readonly Hunk[];
  /** El archivo es enorme y el diff viene recortado; la vista lo advierte. */
  truncated: boolean;
  /** Codificación con la que se leyó. La barra del visor deja cambiarla. */
  encoding: string;
  detectedEncoding?: string;
  decodingErrors?: boolean;
  supportsPartial?: boolean;
}

/**
 * Diff de algo que no es texto.
 *
 * No hay líneas que enseñar, así que el visor dice lo único honesto: qué tipo
 * de archivo es y cuánto pesaba antes y después.
 */
export interface BinaryDiff {
  kind: 'binary';
  /** Bytes; `null` cuando el archivo no existía de ese lado. */
  oldSize: number | null;
  newSize: number | null;
  mediaType: string;
}

/** Modos de entrada que Git guarda en árbol e índice. */
export type GitFileMode = '100644' | '100755' | '120000' | '160000';

/** Identidad exacta de uno de los dos lados del diff. */
export interface DiffSideSnapshot {
  /** OID completo del blob o commit de submódulo. */
  oid: string;
  mode: GitFileMode;
}

/**
 * Los dos extremos que una escritura posterior debe volver a comprobar.
 *
 * `null` no es un hash vacío: significa que ese lado no existía, como en un
 * archivo añadido o eliminado. El modo forma parte de la identidad porque un
 * cambio de ejecutable o de tipo puede conservar exactamente el mismo blob.
 */
export interface DiffPrecondition {
  before: DiffSideSnapshot | null;
  after: DiffSideSnapshot | null;
}

/** De dónde sale el diff. Cada origen se rotula distinto en la interfaz. */
export type DiffSource =
  | { kind: 'worktree' }
  | { kind: 'index' }
  | { kind: 'commit'; sha: Sha }
  | { kind: 'range'; from: Sha; to: Sha }
  /** Efecto neto entre una revisión y el índice + árbol de trabajo actuales. */
  | { kind: 'workingRange'; from: Sha };

export interface DiffRequest {
  path: string;
  source: DiffSource;
  /** Líneas de contexto alrededor de cada cambio. */
  context?: number;
  /** Ignorar cambios en la cantidad de espacios, como pide la barra del visor. */
  ignoreWhitespace?: boolean;
  /** Auto-detect by default; an override reinterprets the original bytes. */
  encoding?: string;
}

export interface FileDiff {
  path: string;
  previousPath?: string;
  change: ChangeType;
  source: DiffSource;
  precondition: DiffPrecondition;
  content: TextDiff | BinaryDiff;
}

/** Contenido completo de un archivo, para la alternancia diff/archivo del visor. */
export interface FileContents {
  path: string;
  text: string | null;
  /** Los binarios no traen texto: traen su tamaño y su tipo. */
  binary: boolean;
  size: number;
  mediaType: string;
  encoding: string;
  detectedEncoding?: string;
  decodingErrors?: boolean;
}
