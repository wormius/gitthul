/**
 * El catálogo tipado de errores de operación.
 *
 * La regla del proyecto es que la salida cruda de git nunca es la respuesta: un
 * fallo se cuenta con una frase sin jerga, una causa y uno o dos arreglos con
 * nombre propio, y la salida original queda plegada debajo como evidencia. Para
 * que eso se cumpla siempre, el fallo viaja como dato —código más parámetros— y
 * no como texto: quien lo produce (un adaptador, hoy el falso y mañana el de
 * Rust) no sabe nada de idiomas, y quien lo pinta traduce al vuelo.
 *
 * Cada código declara **qué parámetros exige**, y de ahí sale la invariante 5:
 * si el error habla de una rama, el tipo obliga a pasar su nombre. No hay forma
 * de construir «no se pudo subir la rama» sin decir cuál.
 *
 * El catálogo crece con el producto — cada fallo que aparezca en pruebas reales
 * se suma aquí con su redacción en los cinco idiomas. Es mantenimiento continuo
 * y no una fase única, así que `unknown` existe para lo que todavía no está.
 */

/**
 * Los parámetros obligatorios de cada error, por código.
 *
 * Va como alias de objeto y no como interfaz a propósito: así cada entrada es
 * asignable a `MessageParams` y se puede pasar tal cual a la traducción.
 */
import type { LogValue } from './logs';

export type GitErrorParams = {
  /** El remoto tiene commits que aquí no están. El caso más frecuente de todos. */
  'push.rejected': { branch: string; remote: string; count: number };
  'push.noUpstream': { branch: string };
  'pull.noUpstream': { branch: string };
  'auth.failed': { remote: string };
  'network.unreachable': { remote: string };
  'remote.notFound': { remote: string };
  'remote.invalidName': { remote: string };
  'remote.invalidUrl': { remote: string };
  'remote.exists': { remote: string };
  'remote.stale': { remote: string };
  'merge.conflict': { source: string; target: string; count: number };
  'rebase.conflict': { source: string; target: string; sha: string; count: number };
  'cherryPick.conflict': { sha: string; target: string; count: number };
  'revert.conflict': { sha: string; target: string; count: number };
  /** Hard se detiene antes de borrar archivos que Git todavía no sigue. */
  'reset.untrackedCollision': { sha: string; count: number };
  'checkout.dirtyTree': { branch: string; count: number };
  'checkout.restoreFailed': { branch: string; count: number };
  /** Git protected local changes while creating a branch with checkout enabled. */
  'branch.checkoutBlocked': { branch: string };
  'branch.exists': { branch: string };
  'branch.current': { branch: string };
  'branch.notMerged': { branch: string; target: string; count: number };
  /** Un commit vacío no existe: lo que se guarda es lo que está preparado. */
  'commit.nothingStaged': Record<string, never>;
  'commit.identityMissing': Record<string, never>;
  /** HEAD o el índice ya no son los que enseñaba el compositor. */
  'commit.stale': Record<string, never>;
  'tag.exists': { tag: string };
  'tag.invalidName': { tag: string };
  'tag.identityMissing': Record<string, never>;
  'stash.nothingToStash': Record<string, never>;
  'stash.partialConflict': Record<string, never>;
  'stash.partialUnsupported': Record<string, never>;
  /** Lo guardado y lo que hay ahora tocan las mismas líneas. */
  'stash.conflict': { stash: string; branch: string; count: number };
  /** La actualización terminó, pero la reaplicación del auto-stash dejó conflictos. */
  'stash.autoConflict': { count: number };
  /** Git se negó antes de aplicar porque el WIP actual sería sobrescrito. */
  'stash.dirtyTree': { stash: string; branch: string; count: number };
  'worktree.removeFailed': { path: string };
  'worktree.pathNotEmpty': { path: string };
  'worktree.branchInUse': { branch: string; path: string };
  /**
   * Hay una fusión, un rebase o un cherry-pick a medias.
   *
   * `kind` viaja aunque la redacción no lo use: es el código de la operación
   * —`merge`, `rebase`— y no una palabra traducible, así que quien pinta elige
   * con él el icono y el verbo, y la frase se apaña con los dos nombres de rama
   * que la invariante 5 exige.
   */
  'operation.inProgress': { kind: string; source: string; target: string };
  'repo.locked': { repo: string };
  'repo.notFound': { repo: string; path: string };
  /** La carpeta existe, pero git no vive en ella. */
  'repo.notARepository': { path: string };
  /** Abrir algo que ya estaba en la lista no es un fallo: es un reencuentro. */
  'repo.alreadyExists': { repo: string; path: string };
  'create.parentNotFound': { path: string };
  'create.destinationExists': { path: string };
  'create.invalidBranch': { branch: string };
  'clone.invalidUrl': { url: string };
  'clone.credentialsInUrl': { url: string };
  'clone.unavailable': { remote: string };
  'clone.destinationNotEmpty': { path: string };
  /** El transporte actual solo puede devolver rutas que sean texto UTF-8 exacto. */
  'text.encodingUnsupported': { encoding: string };
  'resolve.unrepresentable': { path: string; encoding: string };
  'path.encodingUnsupported': { repo: string };
  /** La ruta pedida no existe en el árbol o revisión seleccionados. */
  'path.notFound': { path: string };
  /** Una referencia Git no cabe sin pérdida en el contrato de texto. */
  'ref.encodingUnsupported': { repo: string };
  /** La referencia ya no apunta al objeto que estaba visible al confirmar. */
  'ref.stale': { ref: string };
  /** Un mensaje o una identidad de commit no cabe sin pérdida en el contrato de texto. */
  'history.encodingUnsupported': { repo: string };
  /** El nombre o SHA pedido como inicio de historia no resuelve a un commit. */
  'history.startNotFound': { start: string };
  /** Cherry-pick/revert de un merge necesita elegir qué padre representa la línea principal. */
  'history.mainlineRequired': { sha: string };
  /** La elección debe nombrar uno de los padres reales del commit de merge. */
  'history.mainlineInvalid': { sha: string; parent: number; count: number };
  /** El archivo dejó de ser el mismo que mostraba el diff usado para seleccionar. */
  'write.stale': { path: string };
  /** La operación que se iba a deshacer ya no es la punta actual. */
  'undo.stale': Record<string, never>;
  'undo.snapshotUnavailable': Record<string, never>;
  /** No se pudo escribir el archivo resuelto. Lo escrito no se pierde. */
  'resolve.writeFailed': { path: string };
  /** Se pidió concluir la operación con archivos todavía en conflicto. */
  'resolve.stillConflicted': { count: number };
  /** El archivo que se intentó resolver ya no estaba en conflicto. */
  'resolve.notConflicted': { path: string };
  /** Lo que el catálogo todavía no explica. La salida de git es lo único que hay. */
  unknown: Record<string, never>;
};

export type GitErrorCode = keyof GitErrorParams;

/**
 * Los arreglos que un error puede proponer.
 *
 * Son identificadores y no funciones porque el catálogo es dato puro: quién
 * sabe ejecutar «traer y reintentar» es la vista, que ata cada identificador a
 * su acción. Un arreglo sin quien lo ejecute simplemente no se ofrece.
 */
export type GitFixId =
  | 'fetchAndRetry'
  | 'forcePush'
  | 'setUpstream'
  | 'retry'
  | 'openResolve'
  | 'abortMerge'
  | 'abortRebase'
  /*
   * Los dos genéricos de la operación a medias. No nombran sus ramas —y son la
   * excepción, no la costumbre— porque los comparten errores que no declaran
   * los mismos parámetros: un arreglo se redacta una sola vez para todos los
   * que lo usan, y un hueco que uno de ellos no tenga saldría a la ventana como
   * `{source}` literal. Quien nombra las ramas es el título del error.
   */
  | 'continueOperation'
  | 'abortOperation'
  | 'abortStashRestore'
  | 'chooseMainline'
  | 'openWorktree'
  | 'stashAndSwitch'
  | 'discardChanges'
  | 'checkoutBranch'
  | 'chooseAnotherName'
  | 'mergeFirst'
  | 'deleteAnyway'
  | 'replaceTag'
  | 'stageAll'
  | 'openSettings'
  | 'removeLock'
  | 'forgetRepo'
  | 'locateRepo'
  | 'chooseAnotherFolder'
  | 'createRepoHere'
  | 'selectExisting'
  | 'editUrl';

export interface GitErrorEntry<C extends GitErrorCode> {
  /**
   * Los huecos que la redacción de este error puede usar, en cualquiera de los
   * cinco idiomas. El tipo obliga a que sean parámetros suyos y la prueba del
   * catálogo comprueba que ninguna plantilla invente otros.
   */
  params: readonly (keyof GitErrorParams[C] & string)[];
  /**
   * Los arreglos, en orden. Uno o dos: más de dos ya es una lista de opciones y
   * no una salida. El primero es el más probable y sale como principal.
   */
  fixes: readonly [GitFixId] | readonly [GitFixId, GitFixId];
}

/**
 * Qué ofrece cada error.
 *
 * El texto no está aquí: vive en los cinco catálogos de i18n bajo
 * `error.<código>.title`, `error.<código>.cause` y `errorFix.<arreglo>`. Una
 * prueba comprueba que ninguna de esas plantillas use un hueco que su código no
 * declare, que es como se garantiza que la frase nunca sale con un `{branch}`
 * a la vista.
 */
export const GIT_ERRORS: { [C in GitErrorCode]: GitErrorEntry<C> } = {
  'push.rejected': {
    params: ['branch', 'remote', 'count'],
    fixes: ['fetchAndRetry', 'forcePush'],
  },
  'push.noUpstream': { params: ['branch'], fixes: ['setUpstream'] },
  'pull.noUpstream': { params: ['branch'], fixes: ['retry'] },
  'auth.failed': { params: ['remote'], fixes: ['retry'] },
  'network.unreachable': { params: ['remote'], fixes: ['retry'] },
  'remote.notFound': { params: ['remote'], fixes: ['retry'] },
  'remote.invalidName': { params: ['remote'], fixes: ['chooseAnotherName'] },
  'remote.invalidUrl': { params: ['remote'], fixes: ['editUrl'] },
  'remote.exists': { params: ['remote'], fixes: ['chooseAnotherName'] },
  'remote.stale': { params: ['remote'], fixes: ['retry'] },
  'merge.conflict': {
    params: ['source', 'target', 'count'],
    fixes: ['openResolve', 'abortMerge'],
  },
  'rebase.conflict': {
    params: ['source', 'target', 'sha', 'count'],
    fixes: ['openResolve', 'abortRebase'],
  },
  'cherryPick.conflict': {
    params: ['sha', 'target', 'count'],
    fixes: ['openResolve', 'abortOperation'],
  },
  'revert.conflict': {
    params: ['sha', 'target', 'count'],
    fixes: ['openResolve', 'abortOperation'],
  },
  'reset.untrackedCollision': { params: ['sha', 'count'], fixes: ['retry'] },
  'checkout.dirtyTree': {
    params: ['branch', 'count'],
    fixes: ['stashAndSwitch', 'discardChanges'],
  },
  'checkout.restoreFailed': { params: ['branch', 'count'], fixes: ['openResolve', 'retry'] },
  'branch.checkoutBlocked': { params: ['branch'], fixes: ['retry'] },
  'branch.exists': { params: ['branch'], fixes: ['checkoutBranch', 'chooseAnotherName'] },
  'branch.current': { params: ['branch'], fixes: ['checkoutBranch'] },
  'branch.notMerged': {
    params: ['branch', 'target', 'count'],
    fixes: ['mergeFirst', 'deleteAnyway'],
  },
  'commit.nothingStaged': { params: [], fixes: ['stageAll'] },
  'commit.identityMissing': { params: [], fixes: ['openSettings'] },
  'commit.stale': { params: [], fixes: ['retry'] },
  /*
   * El arreglo de borrar y volver a poner es propio del tag y no el
   * `deleteAnyway` de las ramas: un arreglo se redacta una sola vez para todos
   * sus errores, y «perder {count} commits» no dice nada de un tag —saldría con
   * el hueco a la vista, que es lo que la prueba del catálogo persigue.
   */
  'tag.exists': { params: ['tag'], fixes: ['chooseAnotherName', 'replaceTag'] },
  'tag.invalidName': { params: ['tag'], fixes: ['chooseAnotherName'] },
  'tag.identityMissing': { params: [], fixes: ['openSettings'] },
  'stash.nothingToStash': { params: [], fixes: ['retry'] },
  'stash.partialConflict': { params: [], fixes: ['retry'] },
  'stash.partialUnsupported': { params: [], fixes: ['retry'] },
  'stash.conflict': {
    params: ['stash', 'branch', 'count'],
    fixes: ['openResolve', 'abortOperation'],
  },
  'stash.autoConflict': { params: ['count'], fixes: ['openResolve', 'abortStashRestore'] },
  'stash.dirtyTree': {
    params: ['stash', 'branch', 'count'],
    fixes: ['retry'],
  },
  'worktree.removeFailed': { params: ['path'], fixes: ['openWorktree', 'retry'] },
  'worktree.pathNotEmpty': { params: ['path'], fixes: ['chooseAnotherFolder'] },
  'worktree.branchInUse': {
    params: ['branch', 'path'],
    fixes: ['openWorktree', 'chooseAnotherName'],
  },
  'operation.inProgress': {
    params: ['kind', 'source', 'target'],
    fixes: ['continueOperation', 'abortOperation'],
  },
  'repo.locked': { params: ['repo'], fixes: ['retry', 'removeLock'] },
  'repo.notFound': { params: ['repo', 'path'], fixes: ['locateRepo', 'forgetRepo'] },
  'repo.notARepository': { params: ['path'], fixes: ['chooseAnotherFolder', 'createRepoHere'] },
  'repo.alreadyExists': { params: ['repo', 'path'], fixes: ['selectExisting'] },
  'create.parentNotFound': { params: ['path'], fixes: ['chooseAnotherFolder'] },
  'create.destinationExists': { params: ['path'], fixes: ['chooseAnotherFolder'] },
  'create.invalidBranch': { params: ['branch'], fixes: ['retry'] },
  'clone.invalidUrl': { params: ['url'], fixes: ['editUrl'] },
  'clone.credentialsInUrl': { params: ['url'], fixes: ['editUrl'] },
  'clone.unavailable': { params: ['remote'], fixes: ['retry', 'editUrl'] },
  'clone.destinationNotEmpty': { params: ['path'], fixes: ['chooseAnotherFolder'] },
  'text.encodingUnsupported': { params: ['encoding'], fixes: ['retry'] },
  'resolve.unrepresentable': { params: ['path', 'encoding'], fixes: ['retry'] },
  'path.encodingUnsupported': { params: ['repo'], fixes: ['retry'] },
  'path.notFound': { params: ['path'], fixes: ['retry'] },
  'ref.encodingUnsupported': { params: ['repo'], fixes: ['retry'] },
  'ref.stale': { params: ['ref'], fixes: ['retry'] },
  'history.encodingUnsupported': { params: ['repo'], fixes: ['retry'] },
  'history.startNotFound': { params: ['start'], fixes: ['retry'] },
  'history.mainlineRequired': { params: ['sha'], fixes: ['chooseMainline'] },
  'history.mainlineInvalid': {
    params: ['sha', 'parent', 'count'],
    fixes: ['chooseMainline'],
  },
  'write.stale': { params: ['path'], fixes: ['retry'] },
  'undo.stale': { params: [], fixes: ['retry'] },
  'undo.snapshotUnavailable': { params: [], fixes: ['retry'] },
  /*
   * Los tres de Resolver reutilizan arreglos que ya existen, y no es pereza:
   * un arreglo se redacta una vez para todos sus errores, y aquí lo que se
   * ofrece —volver a intentarlo, o volver a la lista de conflictos— ya estaba
   * escrito para la fusión que falla.
   */
  'resolve.writeFailed': { params: ['path'], fixes: ['retry'] },
  'resolve.stillConflicted': { params: ['count'], fixes: ['openResolve'] },
  'resolve.notConflicted': { params: ['path'], fixes: ['retry'] },
  unknown: { params: [], fixes: ['retry'] },
};

export const GIT_ERROR_CODES = Object.keys(GIT_ERRORS) as readonly GitErrorCode[];

export interface GitErrorOptions {
  /** La salida original de git, tal cual. Nunca es la respuesta, solo la evidencia. */
  output?: string;
  cause?: unknown;
  diagnostic?: LogValue;
}

/**
 * Un fallo de git ya clasificado.
 *
 * Extiende `Error` para que viaje por el rechazo de la promesa como cualquier
 * otro y para que aparezca entero en la consola durante el desarrollo, pero lo
 * que la interfaz consume es el código y los parámetros; el `message` es para
 * quien depura.
 */
export class GitOperationError<C extends GitErrorCode = GitErrorCode> extends Error {
  override readonly name = 'GitOperationError';
  readonly code: C;
  readonly params: GitErrorParams[C];
  readonly output?: string;
  readonly diagnostic?: LogValue;

  constructor(code: C, params: GitErrorParams[C], options: GitErrorOptions = {}) {
    super(`${code} ${JSON.stringify(params)}`, { cause: options.cause });

    this.code = code;
    this.params = params;
    if (options.output !== undefined) this.output = options.output;
    if (options.diagnostic !== undefined) this.diagnostic = options.diagnostic;
  }
}

export function isGitOperationError(value: unknown): value is GitOperationError {
  return value instanceof GitOperationError;
}

/**
 * Lo que la interfaz cancela no es un fallo.
 *
 * Cambiar de pestaña aborta lo que estaba pidiendo la anterior; enseñar un
 * panel de error por eso sería mentir. Va como clase aparte y no como código
 * del catálogo justamente para que nadie lo pinte.
 */
export class OperationCancelledError extends Error {
  override readonly name = 'OperationCancelledError';

  constructor() {
    super('La operación se canceló');
  }
}

export function isCancelled(value: unknown): value is OperationCancelledError {
  return value instanceof OperationCancelledError;
}

export interface DescribedFix {
  id: GitFixId;
  labelKey: `errorFix.${GitFixId}`;
  /** Solo el primero. */
  primary: boolean;
}

export interface DescribedError {
  code: GitErrorCode;
  titleKey: `error.${GitErrorCode}.title`;
  causeKey: `error.${GitErrorCode}.cause`;
  /** Los mismos parámetros para el título, la causa y los arreglos. */
  params: Readonly<Record<string, string | number>>;
  fixes: readonly DescribedFix[];
  output?: string;
}

/** Traduce el error a claves de i18n. Sin tocar `t`: el dominio no traduce. */
export function describeError(error: GitOperationError): DescribedError {
  const entry = GIT_ERRORS[error.code];

  return {
    code: error.code,
    titleKey: `error.${error.code}.title`,
    causeKey: `error.${error.code}.cause`,
    params: error.params,
    fixes: entry.fixes.map((id, index) => ({
      id,
      labelKey: `errorFix.${id}` as const,
      primary: index === 0,
    })),
    ...(error.output === undefined ? {} : { output: error.output }),
  };
}

/**
 * Cualquier cosa que se atrapó, convertida en algo que se puede contar.
 *
 * Un `catch` recibe `unknown`, y lo que no sea del catálogo entra como
 * `unknown` conservando lo que se pueda leer como salida cruda. Así ninguna
 * vista tiene que decidir qué hacer con un fallo que no esperaba.
 */
export function toGitOperationError(value: unknown): GitOperationError {
  if (isGitOperationError(value)) return value;

  const output = value instanceof Error ? value.message : String(value);

  return new GitOperationError('unknown', {}, { output, cause: value });
}
