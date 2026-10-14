import type {
  CommitSequencePrecondition,
  Commit,
  CommitDetails,
  CommitPage,
  CommitPageRequest,
  CommitRequest,
  Person,
  Sha,
} from '@core/domain/commit';
import type {
  DiffPrecondition,
  DiffRequest,
  DiffSource,
  FileContents,
  FileDiff,
} from '@core/domain/diff';
import type {
  IntegrationPrecondition,
  IntegrationPreview,
  RefsSnapshot,
  RefTarget,
  ResetMode,
} from '@core/domain/refs';
import type {
  PullResult,
  ReflogEntry,
  RepoId,
  Repository,
  RepoSummary,
  TransferProgress,
  UndoEntry,
} from '@core/domain/repository';
import type {
  ConflictContents,
  ConflictSideId,
  FileChange,
  Resolution,
  ResetPrecondition,
  TreeEntry,
  WorkingStatus,
} from '@core/domain/status';

/**
 * Opciones que toda consulta acepta.
 *
 * La señal de cancelación no es un adorno: la invariante 4 dice que nada
 * bloquea la interfaz y que toda operación se puede cancelar cuando git lo
 * permite. Cambiar de pestaña o cerrar el visor aborta lo que se estaba
 * pidiendo, y el puerto rechaza con `OperationCancelledError`, que la interfaz
 * distingue de un fallo de verdad y no pinta.
 */
export interface GitQuery {
  signal?: AbortSignal;
}

export interface TextQuery extends GitQuery {
  encoding?: string;
}

/** Lee el blob exacto observado en el diff, incluso cuando pertenece al índice. */
export interface FileQuery extends TextQuery {
  /** Blob exacto resuelto por readDiff, incluido el tercer padre de un stash. */
  blob?: Sha;
}

/** Lo que hace falta para clonar; el clon queda en `path/name`. */
export interface CloneRequest {
  url: string;
  /** Carpeta madre. */
  path: string;
  name: string;
  onProgress?: (progress: CloneProgress) => void;
}

export interface CloneProgress {
  /** Código, no frase: quien lo pinta traduce. */
  phase: 'counting' | 'receiving' | 'resolving' | 'checkout';
  received: number;
  /** `null` cuando el remoto no dice cuánto falta: la barra va indeterminada. */
  total: number | null;
}

/**
 * Lo que la autoresolución dejó hecho.
 *
 * Devuelve las dos cosas porque quien la pide necesita las dos: el estado nuevo
 * para repintar las listas, y qué rutas resolvió para marcarlas como
 * autoresueltas — de un `WorkingStatus` solo se deduce que ya no están en
 * conflicto, no quién las sacó de ahí.
 */
export interface AutoResolveResult {
  resolved: readonly Resolution[];
  status: WorkingStatus;
}

/** Qué lado del diff nombra una línea: la versión nueva o la anterior. */
export type LineSide = 'new' | 'old';

/** Referencia a una línea del diff, identificable por su lado y su número. */
export interface LineRef {
  side: LineSide;
  line: number;
}

/** Selección parcial anclada al diff exacto que vio la persona. */
export interface PartialWriteRequest {
  path: string;
  hunkIds?: readonly string[];
  lines?: readonly LineRef[];
  precondition: DiffPrecondition;
  ignoreWhitespace?: boolean;
}

/** Archivo cuyo contenido sin preparar se confirmó descartar. */
export interface DiscardTarget {
  path: string;
  precondition: DiffPrecondition;
}

export interface RemoteInput {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

/** URLs redactadas que la interfaz observó antes de modificar el remoto. */
export interface RemotePrecondition {
  fetchUrl: string;
  pushUrl: string;
}

/** Alcance agregado de una ráfaga observada fuera de GitThul. */
export interface RepositoryChange {
  worktree: boolean;
  git: boolean;
}

/**
 * Todo lo que la interfaz sabe pedirle a git.
 *
 * Es la frontera de la regla de arquitectura 1: ninguna vista habla con Tauri,
 * habla con esto. Hoy lo implementa el adaptador falso, que es lo que permite
 * construir y pulir el frontend entero; F6.1 y F6.2 lo implementan de verdad
 * sobre gitoxide sin tocar un solo componente.
 *
 * **Una escritura entra aquí cuando su vista ya declaró el gesto que la
 * dispara.** El registro de repositorios llegó con F0.9, la escritura local
 * —preparar, descartar, hacer commit, ramas, tags, checkout y guardados— con
 * F0.10, y con F0.11 lo que quedaba: integrar, red, worktrees y deshacer. Las
 * tres llegaron con el subplan de su vista cerrado detrás; declarar la firma
 * antes que el caso de uso sería inventar la abstracción, que es justo lo que
 * este plan evita.
 *
 * **Toda escritura devuelve el estado que cambió** —`WorkingStatus`,
 * `RefsSnapshot` o `Repository`—, nunca `void`. Es el patrón que
 * la biblioteca fijó en P1.3:
 * el store no puede quedarse con un estado viejo ni tiene que releer detrás de
 * cada escritura. Y como allí, una escritura imposible —quitar del stage lo que
 * no estaba, borrar una rama que no existe— devuelve el mismo estado sin
 * escribir ni lanzar: quien lo explica es el diálogo que valida antes.
 */
export interface GitPort {
  /** Corte transicional: indica si la integración ya cruza el adaptador activo. */
  readonly integrationWritesAvailable: boolean;
  /** Los repositorios que GitThul conoce, incluidos los worktrees. */
  listRepositories: (query?: GitQuery) => Promise<readonly RepoSummary[]>;

  /**
   * Abre una carpeta como repositorio y la suma a los conocidos.
   *
   * Sumarla no es abrirla en una pestaña: eso es un gesto de la vista y no se
   * hace por sorpresa. Falla con `repo.notARepository` si git no vive ahí y con
   * `repo.alreadyExists` si la carpeta ya estaba en la lista.
   */
  openRepository: (path: string, query?: GitQuery) => Promise<Repository>;

  /** Crea el repositorio en `path/name` con su rama inicial y lo suma. */
  createRepository: (
    path: string,
    options: { name: string; initialBranch: string },
    query?: GitQuery,
  ) => Promise<Repository>;

  /**
   * Clona y suma el resultado.
   *
   * Es la operación larga del puerto: informa por `onProgress` y se cancela con
   * la señal. Cancelar rechaza con `OperationCancelledError` y **lo que quedó a
   * medias en disco lo limpia el adaptador**, no quien llamó.
   */
  cloneRepository: (request: CloneRequest, query?: GitQuery) => Promise<Repository>;

  /** Deja de listarlo. No toca el disco: la carpeta y su historia se quedan. */
  forgetRepository: (id: RepoId, query?: GitQuery) => Promise<void>;

  /** Actualiza `lastOpenedAt`, que es lo que ordena los recientes. */
  markOpened: (id: RepoId, at?: number, query?: GitQuery) => Promise<void>;

  /** Observa cambios externos hasta ejecutar la función de cierre devuelta. */
  watchRepository: (
    id: RepoId,
    listener: (change: RepositoryChange) => void,
    query?: GitQuery,
  ) => Promise<() => void>;

  readRepository: (id: RepoId, query?: GitQuery) => Promise<Repository>;

  /** Identidad efectiva de Git para este repositorio; nula si falta nombre o correo. */
  readIdentity: (id: RepoId, query?: GitQuery) => Promise<Person | null>;
  /** Aplica nombre y correo en la configuración local del repositorio. */
  writeIdentity: (id: RepoId, identity: Person, query?: GitQuery) => Promise<Person>;

  /** Ramas, tags, stashes, worktrees y remotos de una vez: es lo que pinta el panel. */
  readRefs: (id: RepoId, query?: GitQuery) => Promise<RefsSnapshot>;

  /** Una página del recorrido de commits, para la tabla virtualizada. */
  readCommits: (id: RepoId, page?: CommitPageRequest, query?: GitQuery) => Promise<CommitPage>;

  /** Lo que solo se pide al seleccionar: mensaje completo y archivos que tocó. */
  readCommit: (id: RepoId, sha: Sha, query?: GitQuery) => Promise<CommitDetails>;

  readStatus: (id: RepoId, query?: GitQuery) => Promise<WorkingStatus>;

  readDiff: (id: RepoId, request: DiffRequest, query?: GitQuery) => Promise<FileDiff>;

  /** Diferencias netas del mismo origen que readDiff; no los archivos tocados en su historia. */
  readDiffFiles: (
    id: RepoId,
    source: DiffSource,
    query?: GitQuery,
  ) => Promise<readonly FileChange[]>;

  /** El archivo completo, para la alternancia diff/archivo del visor. */
  readFile: (id: RepoId, path: string, at?: Sha, query?: FileQuery) => Promise<FileContents>;

  /** Las tres versiones de un archivo en conflicto, para el resolutor. */
  readConflict: (id: RepoId, path: string, query?: TextQuery) => Promise<ConflictContents>;

  /** Los commits que tocaron `path`, más reciente primero — `git log --follow`. */
  readFileHistory: (id: RepoId, path: string, query?: GitQuery) => Promise<readonly Commit[]>;

  /** Árbol completo de una revisión. Sin `at`, devuelve HEAD. */
  readTree: (id: RepoId, at?: Sha, query?: GitQuery) => Promise<readonly TreeEntry[]>;

  stage: (id: RepoId, paths: readonly string[], query?: GitQuery) => Promise<WorkingStatus>;
  unstage: (id: RepoId, paths: readonly string[], query?: GitQuery) => Promise<WorkingStatus>;
  stageHunks: (
    id: RepoId,
    request: PartialWriteRequest,
    query?: GitQuery,
  ) => Promise<WorkingStatus>;
  unstageHunks: (
    id: RepoId,
    request: PartialWriteRequest,
    query?: GitQuery,
  ) => Promise<WorkingStatus>;
  /** Líneas por su lado y número en el diff. */
  stageLines: (
    id: RepoId,
    request: PartialWriteRequest,
    query?: GitQuery,
  ) => Promise<WorkingStatus>;
  unstageLines: (
    id: RepoId,
    request: PartialWriteRequest,
    query?: GitQuery,
  ) => Promise<WorkingStatus>;
  discardAll: (
    id: RepoId,
    precondition: ResetPrecondition,
    options?: GitQuery,
  ) => Promise<WorkingStatus>;
  discard: (
    id: RepoId,
    targets: readonly DiscardTarget[],
    query?: GitQuery,
  ) => Promise<WorkingStatus>;
  /**
   * Descarta líneas sueltas del árbol de trabajo, por su lado y número en el
   * diff. Solo alcanza a lo que no está preparado: descartar no toca el
   * índice, para eso ya está quitar del stage, que sí se deshace.
   */
  discardLines: (
    id: RepoId,
    request: PartialWriteRequest,
    query?: GitQuery,
  ) => Promise<WorkingStatus>;

  /*
   * La escritura de conflictos — F0.15, para la vista Resolver.
   *
   * Las cuatro devuelven el estado resultante, como el resto de la escritura, y
   * las cuatro son cancelables. Lo que **no** hacen es recordar de dónde salió
   * cada resolución más allá de lo que `autoResolve` devuelve: eso es estado de
   * la vista mientras dura la sesión, no del repositorio.
   */

  /** Escribe el archivo resuelto y lo marca como resuelto. */
  resolveConflict: (
    id: RepoId,
    path: string,
    content: string,
    query?: TextQuery & { expectedRevision?: string },
  ) => Promise<WorkingStatus>;
  /** Prepara el contenido actual sin reescribirlo y conserva las etapas para poder desresolver. */
  markConflictsResolved: (
    id: RepoId,
    paths: readonly string[],
    query?: GitQuery,
  ) => Promise<WorkingStatus>;
  markConflictResolved: (id: RepoId, path: string, query?: GitQuery) => Promise<WorkingStatus>;
  /** Devuelve un archivo ya resuelto a conflicto, tal como estaba. */
  unresolveConflict: (id: RepoId, path: string, query?: GitQuery) => Promise<WorkingStatus>;
  /**
   * Se queda con la versión entera de un lado.
   *
   * Es el único camino de los binarios y de lo que pasa de `CONFLICT_TEXT_LIMIT`,
   * y por eso no recibe texto: el contenido no llega a pasar por la ventana.
   */
  keepSide: (
    id: RepoId,
    path: string,
    side: ConflictSideId,
    query?: GitQuery,
  ) => Promise<WorkingStatus>;
  /**
   * Resuelve lo inequívoco y dice qué resolvió.
   *
   * Solo lo que no admite duda: los dos lados idénticos, o uno de los dos igual
   * a la base — nada de heurísticas que puedan acertar mal, que es lo que el
   * plan decidió desde el principio.
   */
  autoResolve: (id: RepoId, query?: GitQuery) => Promise<AutoResolveResult>;

  /** Suma el patrón a `.gitignore`; con `untrack`, además hace `git rm --cached` sobre `path`. */
  ignorePath: (
    id: RepoId,
    pattern: string,
    options?: { untrack?: boolean },
    query?: GitQuery,
  ) => Promise<WorkingStatus>;

  commit: (id: RepoId, request: CommitRequest, query?: GitQuery) => Promise<Sha>;

  createBranch: (
    id: RepoId,
    name: string,
    from: RefTarget,
    options?: { checkout?: boolean },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;
  readReflog: (id: RepoId, query?: GitQuery) => Promise<readonly ReflogEntry[]>;
  recoverReflogEntry: (
    id: RepoId,
    name: string,
    selector: string,
    expectedSha: Sha,
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;
  renameBranch: (
    id: RepoId,
    from: string,
    to: string,
    options?: { expectedTip?: Sha },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;
  deleteBranch: (
    id: RepoId,
    name: string,
    options?: { force?: boolean; expectedTip?: Sha },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;
  setUpstream: (
    id: RepoId,
    branch: string,
    upstream: string | null,
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;

  createTag: (
    id: RepoId,
    name: string,
    at: RefTarget,
    options?: { message?: string },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;
  deleteTag: (
    id: RepoId,
    name: string,
    options?: { expectedTip?: Sha },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;

  /** `autoStash` es lo que CU-8 promete: guarda, cambia y restaura. */
  checkout: (
    id: RepoId,
    target: RefTarget,
    options?: {
      autoStash?: boolean;
      /** Qué hacer si `target` es remota y su copia local ya existe. */
      remoteMode?: 'switch' | 'fastForward' | 'reset';
      /** Puntas vistas por la interfaz: impiden actuar sobre referencias que cambiaron. */
      expectedLocalTip?: Sha;
      expectedRemoteTip?: Sha;
    },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;

  createStash: (
    id: RepoId,
    message: string,
    options?: {
      includeUntracked?: boolean;
      keepStaged?: boolean;
      /** Sin rutas guarda todo; con rutas guarda el archivo entero de cada una. */
      paths?: readonly string[];
      precondition?: ResetPrecondition;
    },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;
  /** Cambia solo el mensaje visible del guardado, sin aplicarlo ni reordenarlo. */
  renameStash: (
    id: RepoId,
    index: number,
    message: string,
    options?: { expectedStash?: Sha },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;
  applyStash: (
    id: RepoId,
    index: number,
    options?: { drop?: boolean; expectedStash?: Sha; precondition?: ResetPrecondition },
    query?: GitQuery,
  ) => Promise<WorkingStatus>;
  dropStash: (
    id: RepoId,
    index: number,
    options?: { expectedStash?: Sha },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;

  /**
   * Qué pasaría si se soltara `source` sobre `target`, sin tocar nada.
   *
   * Es lo que la vista previa del arrastre pinta en palabras antes de que nadie
   * confirme: un arrastre accidental nunca hace daño porque esto no escribe.
   */
  previewIntegration: (
    id: RepoId,
    kind: 'merge' | 'rebase',
    source: string,
    target: string,
    query?: GitQuery,
  ) => Promise<IntegrationPreview>;

  /** Trae `source` a la rama activa. Con `noFastForward` siempre deja commit de fusión. */
  merge: (
    id: RepoId,
    source: string,
    options?: { noFastForward?: boolean; precondition?: IntegrationPrecondition },
    query?: GitQuery,
  ) => Promise<Repository>;
  /** Reescribe los commits propios de la rama activa encima de `onto`. */
  rebase: (
    id: RepoId,
    onto: string,
    options?: { precondition?: IntegrationPrecondition },
    query?: GitQuery,
  ) => Promise<Repository>;
  /** Los commits en el orden dado: quien los seleccionó sabe cuál va primero. */
  cherryPick: (
    id: RepoId,
    shas: readonly Sha[],
    options?: { precondition?: CommitSequencePrecondition; mainline?: number },
    query?: GitQuery,
  ) => Promise<Repository>;
  revert: (
    id: RepoId,
    shas: readonly Sha[],
    options?: { precondition?: CommitSequencePrecondition; mainline?: number },
    query?: GitQuery,
  ) => Promise<Repository>;
  reset: (
    id: RepoId,
    to: Sha,
    mode: ResetMode,
    options?: { expectedBranch: string; precondition: ResetPrecondition },
    query?: GitQuery,
  ) => Promise<Repository>;

  /**
   * Cierra o tira lo que quedó a medias.
   *
   * Las dos devuelven el repositorio porque lo que cambia es su `operation`, y
   * esa marca y WorkingStatus.recoveryOperation deciden si Resolver sigue activo.
   * En autoStash la integración ya terminó: abortar conserva HEAD actualizado y
   * el stash original; continuar tras resolver termina la reaplicación y retira ese stash.
   */
  continueOperation: (id: RepoId, query?: GitQuery) => Promise<Repository>;
  abortOperation: (id: RepoId, query?: GitQuery) => Promise<Repository>;
  /** Cierra la operación sin commit y conserva índice y árbol; exige cero conflictos. */
  quitOperation: (id: RepoId, query?: GitQuery) => Promise<Repository>;

  /** Sin `remote`, todos los que haya. `prune` limpia las remotas que ya no existen. */
  fetch: (
    id: RepoId,
    remote: string | null,
    options?: { onProgress?: (p: TransferProgress) => void; prune?: boolean },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;

  /**
   * Trae y integra, decidiendo cómo.
   *
   * Con `'auto'` —que es el clic izquierdo— la estrategia la elige el puerto,
   * que es donde vive el dato que la decide: si lo local ya estaba publicado o
   * no. La vista no razona sobre eso, solo repite lo que `PullResult` cuenta.
   */
  pull: (
    id: RepoId,
    options?: {
      strategy?: 'auto' | 'rebase' | 'merge';
      onProgress?: (p: TransferProgress) => void;
    },
    query?: GitQuery,
  ) => Promise<PullResult>;

  push: (
    id: RepoId,
    branch: string,
    options?: {
      remote?: string;
      setUpstream?: boolean;
      /** OID remoto que se vio antes de confirmar; activa force-with-lease, nunca `--force`. */
      expectedRemoteTip?: Sha;
      onProgress?: (p: TransferProgress) => void;
    },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;

  addRemote: (id: RepoId, remote: RemoteInput, query?: GitQuery) => Promise<RefsSnapshot>;
  updateRemote: (
    id: RepoId,
    currentName: string,
    remote: RemoteInput,
    expected: RemotePrecondition,
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;
  removeRemote: (
    id: RepoId,
    name: string,
    expected: RemotePrecondition,
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;

  /** El worktree nuevo es un repositorio más de la lista: por eso devuelve su ficha. */
  createWorktree: (
    id: RepoId,
    path: string,
    branch: RefTarget,
    query?: GitQuery,
  ) => Promise<RepoSummary>;
  removeWorktree: (
    id: RepoId,
    path: string,
    options?: { force?: boolean },
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;
  lockWorktree: (
    id: RepoId,
    path: string,
    locked: boolean,
    query?: GitQuery,
  ) => Promise<RefsSnapshot>;

  /**
   * Las dos pilas, para pintar la lista sin ejecutar nada.
   *
   * El push nunca aparece en ninguna de las dos: revertir algo publicado es una
   * acción aparte y explícita, y esa decisión no se reabre.
   */
  readUndoStack: (
    id: RepoId,
    query?: GitQuery,
  ) => Promise<{ undo: readonly UndoEntry[]; redo: readonly UndoEntry[] }>;
  undo: (id: RepoId, query?: GitQuery) => Promise<Repository>;
  redo: (id: RepoId, query?: GitQuery) => Promise<Repository>;
}
