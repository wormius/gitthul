/** El árbol de trabajo: qué cambió, qué está preparado y qué está en conflicto. */

export type ChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'typeChanged'
  | 'conflicted'
  | 'unmodified';

/** Una entrada del árbol de archivos del proyecto — `git ls-tree`. */
export interface TreeEntry {
  path: string;
  kind: 'file' | 'directory';
}

/**
 * Qué hizo cada lado con el archivo.
 *
 * No es un detalle técnico: Resolver enseña dos paneles y tiene que decir qué
 * pasó en cada uno, y «lo borraron allá» no se resuelve como «lo cambiamos los
 * dos».
 */
export type ConflictKind =
  | 'bothModified'
  | 'bothAdded'
  | 'bothDeleted'
  | 'deletedByUs'
  | 'deletedByThem'
  | 'addedByUs'
  | 'addedByThem';

export interface FileChange {
  path: string;
  /** Ruta anterior en renombrados y copias. */
  previousPath?: string;
  change: ChangeType;
  /** Contenido no textual: el visor enseña la ficha binaria, no un diff. */
  binary: boolean;
  insertions: number;
  deletions: number;
  /** Solo cuando `change` es `conflicted`. */
  conflict?: ConflictKind;
}

/** Foto de las dos referencias que determinan exactamente qué guardará un commit. */
export interface CommitPrecondition {
  /** `null` en un repositorio que todavía no tiene su primer commit. */
  head: string | null;
  /** Huella de modo, OID, etapa y ruta de cada entrada del índice; `null` si no pudo leerse. */
  indexTree: string | null;
}

/** Foto de todo lo que cada modalidad de Reset podría reemplazar. */
export interface ResetPrecondition {
  /** Huella de archivos nuevos, obligatoria en el backend para descartar todo. */
  untrackedTree?: string | null;
  /** Punta exacta que estaba activa al abrir la confirmación. */
  head: string | null;
  /** Huella opaca del índice; Mixed y Hard la revalidan. */
  indexTree: string | null;
  /** Huella de cambios rastreados sin preparar; solo Hard la revalida. */
  worktreeTree: string | null;
}

/**
 * Lo que hay ahora mismo en el repositorio, repartido como lo pide la vista:
 * preparados arriba, sin preparar abajo, y los conflictos aparte porque
 * bloquean la vista hasta que se resuelven.
 */
export interface WorkingStatus {
  staged: readonly FileChange[];
  unstaged: readonly FileChange[];
  conflicted: readonly FileChange[];
  /** Sin cambios no hay nodo WIP en el grafo. */
  clean: boolean;
  /** Solo el adaptador real la entrega; permite rechazar un compositor obsoleto. */
  commitPrecondition?: CommitPrecondition;
  /** Permite que Reset rechace una confirmación obsoleta antes de sobrescribir. */
  resetPrecondition?: ResetPrecondition;
  /** Recuperación privada disponible para terminar o cancelar un stash conflictivo. */
  recoveryOperation?: 'apply' | 'pop';
}

/**
 * Las tres versiones de un archivo en conflicto, tal como las pide el resolutor
 * de tres paneles.
 *
 * `base` es `null` cuando el archivo nació en las dos ramas a la vez: no hubo
 * antepasado común del que partir, y el editor lo dice en vez de fingir un
 * panel vacío.
 */
export interface ConflictContents {
  encoding?: string;
  detectedEncoding?: string;
  decodingErrors?: boolean;
  /** Identidad de las etapas leídas; revalidada antes de escribir la resolución. */
  revision?: string;
  path: string;
  kind: ConflictKind;
  base: string | null;
  ours: string | null;
  theirs: string | null;
  /** Nombres de rama para rotular cada panel. Nunca «el nuestro» a secas. */
  oursLabel: string;
  theirsLabel: string;
  /** Cuánto ocupa cada lado. Llega siempre, incluso cuando el texto no llega. */
  sizes: { ours: ConflictSize; theirs: ConflictSize };
  /** Alguna etapa contiene bytes que no son texto; solo se puede tomar un lado entero. */
  binary: boolean;
  /**
   * El archivo pasa de `CONFLICT_TEXT_LIMIT`.
   *
   * Cuando es `true`, `base`, `ours` y `theirs` llegan en `null` **aunque el
   * archivo exista en los dos lados**: el puerto no carga un texto que la vista
   * no va a poder enseñar. Lo que se hace con él es quedarse con un lado entero.
   */
  tooLarge: boolean;
}

/** Cuánto ocupa una versión de un archivo en conflicto. */
export interface ConflictSize {
  bytes: number;
  lines: number;
}

/**
 * Hasta dónde llega el resolutor de tres paneles.
 *
 * Vive en el dominio y no en la vista porque **el puerto también lo respeta**:
 * por encima de este tope no devuelve texto, así que la ventana nunca carga
 * cincuenta megas que solo iba a poder tirar. Lo caro no es pintar —el visor
 * virtualiza— sino el cálculo a tres bandas y un control interactivo por bloque
 * y por línea.
 *
 * Los dos números son un punto de partida medido en F3.2 con un archivo real al
 * filo; mover el tope es cambiarlos aquí, en un solo sitio.
 */
export const CONFLICT_TEXT_LIMIT = {
  bytes: 5 * 1024 * 1024,
  lines: 50_000,
} as const;

/** Si cualquiera de los lados pasa del tope, el archivo entero pasa. */
export function exceedsConflictLimit(...sizes: readonly ConflictSize[]): boolean {
  return sizes.some(
    (size) => size.bytes > CONFLICT_TEXT_LIMIT.bytes || size.lines > CONFLICT_TEXT_LIMIT.lines,
  );
}

/** Cuánto ocupa un texto, en las dos unidades del tope. */
export function sizeOfText(text: string | null): ConflictSize {
  if (text === null) return { bytes: 0, lines: 0 };

  return { bytes: text.length, lines: text.split('\n').length };
}

/** Cuál de los dos lados de un conflicto. */
export type ConflictSideId = 'ours' | 'theirs';

/**
 * De dónde salió la resolución de un archivo.
 *
 * Lo consume la lista de Resueltos, que marca lo autoresuelto para que se sepa
 * qué decidió la máquina y qué decidiste tú. `ours` y `theirs` son el resultado
 * de quedarse con un lado entero —la ficha de los binarios y de lo que pasa del
 * tope—; `manual` es todo lo que salió del resolutor.
 */
export type ResolutionOrigin = 'manual' | 'auto' | 'ours' | 'theirs';

export interface Resolution {
  path: string;
  origin: ResolutionOrigin;
}
