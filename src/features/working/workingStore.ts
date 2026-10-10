import { create } from 'zustand';
import type { GitOperationError } from '@core/domain/errors';

import type { CommitSequencePrecondition, Sha } from '@core/domain/commit';
import type { DiffSource } from '@core/domain/diff';
import type { Branch, Remote, RefTarget, ResetMode, Stash } from '@core/domain/refs';
import type { RepoId, TransferProgress, UndoEntry } from '@core/domain/repository';
import type { ResetPrecondition } from '@core/domain/status';
import type { DiscardTarget, PartialWriteRequest } from '@core/ports/GitPort';

import type { CompareSide } from './contextMenus';
import { BODY_LIMIT, normalizeCommitSummary, SUMMARY_LIMIT } from './commitMessage';
import type { GraphNodeForm } from './graphPaint';
import type { DragRef } from './integration';
import type { FileSort, FileView } from './staging';

/**
 * La info mínima que el modal de push rechazado necesita para nombrarlo todo.
 *
 * Invariante 5: «La publicación de `feature/x` en `origin` fue rechazada», no
 * «La publicación fue rechazada».
 */
export interface PushRejectedInfo {
  branch: string;
  remote: string;
  /** Punta remota que la persona vio; es el lease exacto del único camino de fuerza. */
  expectedRemoteTip: Sha;
}

/**
 * Lo que un diálogo de esta vista necesita saber para abrirse.
 *
 * Es **intención, no ejecución**: el gesto o el menú declara qué se quiere
 * hacer y sobre qué, y quien lo ejecuta es `WorkingView`, que es donde viven
 * los puertos y el estado del repositorio. Así un atajo de teclado —que se
 * dispara desde fuera del árbol de la vista— puede pedir «crear una rama desde
 * `main`» sin tener que conocer `GitPort`.
 *
 * Cada variante lleva ya escritos los nombres que su frase va a nombrar, que es
 * lo que la invariante 5 exige: ningún diálogo dice «esta rama».
 */
export type WorkingDialog =
  | { kind: 'createBranch'; from: RefTarget; fromLabel: string }
  | { kind: 'recoverHistory' }
  | { kind: 'renameBranch'; branch: string; expectedTip: Sha }
  | { kind: 'createTag'; at: RefTarget; atLabel: string }
  | { kind: 'createWorktree'; branch: string | null }
  | { kind: 'deleteBranch'; branch: string; expectedTip: Sha }
  | { kind: 'deleteTag'; tag: string; expectedTip: Sha }
  | { kind: 'publishBranch'; branch: string; remotes: readonly string[] }
  | { kind: 'remote'; remote?: Remote }
  | { kind: 'remoteCredentials'; remote: Remote }
  | { kind: 'removeRemote'; remote: Remote }
  | { kind: 'removeWorktree'; path: string; name: string }
  | {
      kind: 'cherryPick';
      shas: readonly Sha[];
      contiguous: boolean;
      precondition: CommitSequencePrecondition;
    }
  | {
      kind: 'revert';
      shas: readonly Sha[];
      contiguous: boolean;
      precondition: CommitSequencePrecondition;
    }
  | {
      kind: 'reset';
      sha: Sha;
      mode: ResetMode;
      expectedBranch: string;
      precondition: ResetPrecondition;
    }
  | { kind: 'discardAll'; count: number; precondition: ResetPrecondition }
  | { kind: 'discard'; targets: readonly DiscardTarget[] }
  | { kind: 'discardLines'; request: PartialWriteRequest }
  | { kind: 'stash'; branch: string }
  | { kind: 'dropStash'; stash: Stash }
  | { kind: 'remoteBranchAhead'; local: Branch; remote: Branch };

/**
 * Lo que `ActionPreview` necesita para abrirse — F2.7.
 *
 * El panel aparece al soltar una referencia sobre otra, o al pulsar
 * fusionar/rebasar en el menú contextual.
 */
export interface ActionPreviewState {
  kind: 'merge' | 'rebase';
  source: DragRef;
  target: DragRef;
  headBranch: string;
}

/**
 * Lo que el panel derecho compara — CU-14.
 *
 * Los dos extremos son lo mismo para el panel, vengan de dos ramas, de un tag y
 * una rama o de dos commits marcados; el diff combinado, en cambio, no tiene dos
 * extremos que restar sino una lista de commits que se suman, y por eso es una
 * variante aparte y no un rango con un nombre distinto.
 */
export type WorkingCompare =
  | {
      kind: 'refs';
      source: CompareSide;
      target: CompareSide;
      trigger?: 'selection';
    }
  | { kind: 'combined'; shas: readonly Sha[]; trigger?: 'selection' };

/** Qué archivo tiene abierto el visor de diff, y de dónde — CU-5. */
export interface WorkingDiff {
  path: string;
  source: DiffSource;
  /**
   * El commit al que se vuelve al cerrar.
   *
   * CU-5 pide que cerrar el visor «devuelva el grafo con el foco en el commit
   * que estaba seleccionado», así que se anota al abrir y no al cerrar: entre
   * una cosa y la otra la selección puede haber cambiado desde el panel de
   * detalles. Es `null` cuando no había ninguno o cuando el visor se abrió desde
   * el historial de un archivo, que según CU-19 vuelve al historial y no al
   * grafo.
   */
  returnTo: Sha | null;
}

/** Una o dos columnas — CU-5. */
export type DiffColumns = 'unified' | 'split';

/** Solo los hunks con su contexto, o el archivo entero. */
export type DiffScope = 'hunks' | 'file';

/** El resultado del diff, o el archivo tal cual quedó. */
export type DiffContent = 'diff' | 'file';

/**
 * Cómo se lee un diff, no cuál.
 *
 * Vive aparte de `WorkingDiff` porque es preferencia de la persona y no del
 * archivo: quien lee a dos columnas quiere dos columnas también en el siguiente
 * archivo que abra, y por eso esto sobrevive a cerrar el visor y a cambiar de
 * pestaña, como el plegado de los paneles.
 */
export interface DiffOptions {
  columns: DiffColumns;
  scope: DiffScope;
  content: DiffContent;
  /** Auto-detect or reinterpret the original bytes with this encoding. */
  encoding: string;
  /** `DiffRequest.ignoreWhitespace`: cambios en la cantidad de espacios. */
  ignoreWhitespace: boolean;
  wrap?: boolean;
}

/** Detect each file from its bytes until a decoder is selected explicitly. */
export const DEFAULT_ENCODING = 'auto';

/** El mensaje a medio escribir, que sobrevive a moverse por la vista. */
export interface CommitDraft {
  summary: string;
  body: string;
  amend: boolean;
  amendHead?: Sha;
  amendLoaded?: boolean;
  amendError?: GitOperationError;
  amendMessageOnly?: boolean;
  beforeAmend?: { summary: string; body: string };
}

/**
 * De qué lista de archivos salió la selección.
 *
 * Es un solo campo y no dos porque las dos listas nunca están marcadas a la
 * vez: sus acciones son opuestas, así que marcar en Seguimiento suelta lo de
 * Stage. De la lista sale también con qué origen se lee el diff —Seguimiento es
 * el árbol de trabajo, Stage es el índice—, así que no hace falta guardarlo.
 */
export type FileListId = 'tracking' | 'stage';

export interface FileSelection {
  list: FileListId;
  paths: readonly string[];
}

/**
 * La referencia señalada en el panel izquierdo — CU-3.
 *
 * Existe para que los gestos de `checkout`, borrar rama y borrar tag tengan
 * sobre qué actuar: `GestureDefinition.run` no lleva parámetros, así que un
 * gesto solo alcanza lo que el store sabe. `isHead` viaja con ella porque los
 * tres rótulos y los tres estados deshabilitados dependen de si lo señalado es
 * ya la rama activa.
 */
export interface SelectedRef {
  kind: 'localBranch' | 'remoteBranch' | 'tag';
  name: string;
  isHead: boolean;
  target: Sha;
  remote?: string;
}

/** Qué se pidió hacer con unos archivos, desde un gesto que no tiene puertos. */
export type FileRequestKind =
  'stage' | 'unstage' | 'discard' | 'stageAll' | 'unstageAll' | 'ignore' | 'ignoreUntrack';

/** Lo mínimo del repositorio abierto que los gestos globales necesitan. */
export interface WorkingContext {
  repoId: RepoId;
  repoName: string;
  headBranch: string | null;
  headSha: Sha;
  resetPrecondition: ResetPrecondition;
  headUpstream: { name: string; remote: string; tip: Sha } | null;
  remoteNames: readonly string[];
  /** Cuántos archivos hay en el stage: es lo que habilita «Hacer commit». */
  stagedCount: number;
  canAmend?: boolean;
  hasWip?: boolean;
  stashes?: readonly Stash[];
  /** Cuántos hay en Seguimiento: lo que habilita «Pasar todo al stage». */
  trackedCount: number;
  undoEntry?: UndoEntry | undefined;
  redoEntry?: UndoEntry | undefined;
  undoCount?: number;
  redoCount?: number;
}

export interface WorkingState {
  pendingWrites: number;
  /** El panel izquierdo, en modo rail — CU-17. */
  refsCollapsed: boolean;
  /** El panel derecho, plegado a cero — CU-17. */
  detailsCollapsed: boolean;
  /** CU-4: los commits marcados, por la clave de su fila en la tabla. */
  selectedCommits: ReadonlySet<string>;
  /** CU-6: los archivos marcados y en cuál de las dos listas, o ninguno. */
  fileSelection: FileSelection | null;
  /** CU-3: la referencia señalada en el panel izquierdo, o ninguna. */
  selectedRef: SelectedRef | null;
  /** El diálogo abierto, o ninguno. Solo uno a la vez. */
  dialog: WorkingDialog | null;
  /** CU-19: archivo y versión desde la que se abrió su historial. */
  fileHistory: { path: string; at?: Sha; openLatest?: boolean } | null;
  /** CU-5: el archivo abierto en el visor de diff, o ninguno. */
  diff: WorkingDiff | null;
  /** Cómo se lee un diff. Preferencia de la persona, no del archivo. */
  diffOptions: DiffOptions;
  /**
   * A qué commit hay que llevar la tabla.
   *
   * Lleva `nonce` porque pedir dos veces el mismo nodo tiene que desplazar dos
   * veces: sin él, «Ir a su nodo» sobre la rama que ya está a la vista no haría
   * nada después de un scroll manual.
   */
  goTo: { sha: Sha; nonce: number } | null;
  /**
   * Cuántas veces se reescribió el historial desde que se abrió la vista.
   *
   * Cherry-pick, revertir y restablecer cambian los commits, no solo las
   * referencias, así que la tabla tiene que volver a paginar desde cero. Un
   * contador y no una bandera: dos operaciones seguidas son dos recargas.
   */
  historyVersion: number;
  /** La forma del nodo del grafo — submenú «Nodos ▸» de la cabecera. */
  nodeForm: GraphNodeForm;
  /** Lista o árbol en todas las listas de archivos — `working.toggleFileTree`. */
  fileView: FileView;
  /** Preferencia global del árbol de archivos: todas las carpetas abiertas o cerradas. */
  fileTreeExpanded: boolean;
  fileSort: FileSort;
  fileFilter: string;
  /**
   * Cambia cada vez que alguien pide el foco del filtro de archivos.
   *
   * Nonce y no bandera, por lo mismo que `goTo`: pedirlo dos veces seguidas
   * tiene que traer el foco las dos, aunque nadie lo haya movido en medio.
   */
  filterFocus: number;
  /** Lo que el panel derecho compara, o nada — CU-14. */
  compare: WorkingCompare | null;
  /** La vista previa de integración al soltar — F2.7. */
  actionPreview: ActionPreviewState | null;
  /** Nombre opcional del conjunto de cambios actual; `null` significa WIP. */
  wipName: string | null;
  /** El mensaje a medio escribir del compositor. */
  commitDraft: CommitDraft;
  /**
   * Un commit pedido desde fuera del compositor — `Mod+Enter`.
   *
   * El registro de gestos no conoce los puertos, así que lo que deja es esta
   * petición y quien la atiende es `CommitComposer`, que sí los tiene. Mismo
   * patrón que `goTo` con la tabla.
   */
  commitRequest: { amend: boolean; nonce: number } | null;
  /**
   * Peticiones de operaciones que necesitan los puertos — F2.8.
   *
   * El registro de gestos no tiene acceso a `GitPort`, así que lo que deja es
   * un nonce y quien lo atiende es `WorkingView`, que sí los tiene. Es el mismo
   * patrón que `commitRequest`.
   */
  /**
   * Lo que un gesto de archivo pidió, para que lo atienda quien tiene puertos.
   *
   * Mismo patrón que `commitRequest`: el registro de gestos no conoce
   * `GitPort`, así que deja la intención con su nonce y `WorkingView` la
   * ejecuta. `stageAll` y `unstageAll` no traen rutas porque quien las resuelve
   * es quien tiene el `WorkingStatus` delante.
   */
  fileRequest: { kind: FileRequestKind; paths: readonly string[]; nonce: number } | null;
  /** Lo mismo para «cambiar a la referencia señalada» — CU-3. */
  checkoutRequest: { target: RefTarget; name: string; nonce: number } | null;
  undoRequest: number;
  redoRequest: number;
  stashRequest: number;
  popRequest: number;
  popTarget: Stash | null;
  continueRequest: number;
  abortRequest: number;
  /** Peticiones de operaciones de red — F2.9. */
  fetchRequest: number;
  pullRequest: number;
  pushRequest: number;
  cancelNetworkRequest: number;
  /** Si hay una operación de red en curso, las tres se deshabilitan. */
  networkBusy: boolean;
  /** Progreso transitorio de red; la fase es código y se traduce al pintar. */
  networkProgress: TransferProgress | null;
  /** Petición monotónica para devolver foco al iniciador al cerrar la franja. */
  networkFocusRequest: number;
  networkFocusGesture: 'working.fetch' | 'working.pull' | 'working.push';
  /** El panel de push rechazado abierto, con la info del error. */
  pushRejected: PushRejectedInfo | null;
  /** El repositorio abierto, para los gestos que viven fuera de la vista. */
  context: WorkingContext | null;
  /**
   * Color de grafo por nombre de referencia (rama o tag).
   *
   * Es un mapa ligero (`nombre → 1..8`) que `CommitTable` actualiza cada vez
   * que recalcula el layout del grafo. Lo consumen `RefLabel` (el chip) y
   * `RefRow` (el icono del panel izquierdo) para pintar con el color de la
   * calle que les corresponde.
   */
  refColors: ReadonlyMap<string, number>;
}

export interface WorkingActions {
  setRefsCollapsed: (collapsed: boolean) => void;
  setDetailsCollapsed: (collapsed: boolean) => void;
  setSelectedCommits: (selected: ReadonlySet<string>) => void;
  setFileSelection: (selection: FileSelection | null) => void;
  setSelectedRef: (ref: SelectedRef | null) => void;
  openDialog: (dialog: WorkingDialog) => void;
  closeDialog: () => void;
  openFileHistory: (path: string, at?: Sha, openLatest?: boolean) => void;
  closeFileHistory: () => void;
  /** Abre el visor sobre un archivo. El commit al que volver lo pone el store. */
  openDiff: (request: { path: string; source: DiffSource }) => void;
  closeDiff: () => void;
  /** Parche sobre las opciones: la barra mueve una cosa a la vez. */
  setDiffOptions: (patch: Partial<DiffOptions>) => void;
  requestGoTo: (sha: Sha) => void;
  bumpHistory: () => void;
  setNodeForm: (form: GraphNodeForm) => void;
  setFileView: (view: FileView) => void;
  setFileTreeExpanded: (expanded: boolean) => void;
  setFileSort: (sort: FileSort) => void;
  setFileFilter: (filter: string) => void;
  requestFilterFocus: () => void;
  openCompare: (compare: WorkingCompare) => void;
  closeCompare: () => void;
  openActionPreview: (state: ActionPreviewState) => void;
  closeActionPreview: () => void;
  /** Parche sobre el borrador: nadie escribe los tres campos a la vez. */
  setCommitDraft: (patch: Partial<CommitDraft>) => void;
  clearCommitDraft: () => void;
  setWipName: (name: string | null) => void;
  requestCommit: (amend: boolean) => void;
  clearCommitRequest: () => void;
  requestFileAction: (kind: FileRequestKind, paths: readonly string[]) => void;
  clearFileRequest: () => void;
  requestCheckout: (target: RefTarget, name: string) => void;
  clearCheckoutRequest: () => void;
  requestUndo: () => void;
  requestRedo: () => void;
  requestStash: () => void;
  requestPop: () => void;
  requestContinue: () => void;
  requestAbort: () => void;
  requestFetch: () => void;
  requestPull: () => void;
  requestPush: () => void;
  requestCancelNetwork: () => void;
  setNetworkBusy: (busy: boolean) => void;
  setNetworkProgress: (progress: TransferProgress | null) => void;
  requestNetworkFocus: (gesture: 'working.fetch' | 'working.pull' | 'working.push') => void;
  openPushRejected: (info: PushRejectedInfo) => void;
  closePushRejected: () => void;
  setContext: (context: WorkingContext | null) => void;
  setRefColors: (colors: ReadonlyMap<string, number>) => void;
  /**
   * La descarga parcial al cambiar de pestaña — CU-17: «al perder el foco la
   * pestaña libera lo pesado —grafo calculado, diffs, contenido de archivos— y
   * conserva el resumen ligero».
   *
   * **El grafo de F2.3 no pasa por aquí, y es lo correcto.** Lo calculado vive
   * en un `useMemo` de `CommitTable`, y `ViewRouter` monta `WorkingView` con el
   * `repoId` por `key`: dejar la pestaña desmonta la vista y con ella se va el
   * cálculo, sin que nadie tenga que acordarse de soltarlo. Meterlo en el store
   * para poder «liberarlo» aquí sería justo al revés — lo mantendría vivo
   * después del desmontaje para luego tener que borrarlo a mano, que es la
   * definición de una fuga con un botón de limpieza al lado.
   *
   * **El diff calculado de F2.6 tampoco pasa por aquí, por lo mismo.** Lo que
   * el puerto devolvió vive en el `useAsyncData` de `DiffViewer`, que se va con
   * el desmontaje de la vista; guardarlo en el store para poder soltarlo aquí
   * sería mantenerlo vivo después del desmontaje para luego borrarlo a mano.
   * Cachearlo entre montajes sería otra responsabilidad: necesitaría una caché
   * por pestaña para el grafo y los diffs. Construirla aquí, con la vista
   * remontándose entera al cambiar de pestaña, no ahorraría nada.
   *
   * Lo que sí suelta ya son las cosas que **no** deben sobrevivir al cambio de
   * pestaña: la selección de commits, el diálogo abierto, el panel de historial
   * y el archivo abierto en el visor apuntan a un repositorio concreto, y volver
   * con ellos puestos enseñaría el diff de otro repositorio.
   */
  unload: () => void;
  /** Vuelve al estado de arranque. La usan las pruebas entre casos. */
  reset: () => void;
}

function freshState(): WorkingState {
  return {
    pendingWrites: 0,
    refsCollapsed: false,
    detailsCollapsed: false,
    selectedCommits: new Set(),
    fileSelection: null,
    selectedRef: null,
    dialog: null,
    fileHistory: null,
    diff: null,
    diffOptions: {
      columns: 'split',
      scope: 'file',
      content: 'diff',
      encoding: DEFAULT_ENCODING,
      ignoreWhitespace: false,
    },
    goTo: null,
    historyVersion: 0,
    nodeForm: 'ring',
    fileView: 'flat',
    fileTreeExpanded: true,
    fileSort: 'path',
    fileFilter: '',
    filterFocus: 0,
    compare: null,
    actionPreview: null,
    commitDraft: { summary: '', body: '', amend: false },
    commitRequest: null,
    wipName: null,
    fileRequest: null,
    checkoutRequest: null,
    undoRequest: 0,
    redoRequest: 0,
    stashRequest: 0,
    popRequest: 0,
    popTarget: null,
    continueRequest: 0,
    abortRequest: 0,
    fetchRequest: 0,
    pullRequest: 0,
    pushRequest: 0,
    cancelNetworkRequest: 0,
    networkBusy: false,
    networkProgress: null,
    networkFocusRequest: 0,
    networkFocusGesture: 'working.fetch',
    pushRejected: null,
    context: null,
    refColors: new Map(),
  };
}

/**
 * El commit marcado, si es exactamente uno y es un commit de verdad.
 *
 * Las claves de fila de la tabla incluyen el nodo WIP y los guardados, que no
 * son sitios a los que volver: son filas sintéticas que `buildCommitRows` pone
 * encima del historial.
 */
function singleCommitOf(selected: ReadonlySet<string>): Sha | null {
  if (selected.size !== 1) return null;

  const [key] = [...selected];

  if (key === undefined || key === 'wip' || key.startsWith('stash:')) return null;

  return key;
}

/**
 * El estado de la vista GitWorking que no vive en ningún componente.
 *
 * Lo que está aquí y no en un `useState` tiene un motivo compartido: hay algo
 * fuera del árbol de `WorkingView` que necesita tocarlo. El plegado de los dos
 * paneles se comparte entre sus botones y la búsqueda; la selección de commits
 * y el diálogo abierto también reciben acciones del registro global.
 *
 * No vive por repositorio ni por pestaña: dos pestañas de GitWorking comparten
 * el mismo plegado de panel, que es preferencia de la persona y no un dato del
 * repositorio — el mismo criterio que ya usa `SplitPane` con sus anchos
 * guardados por `storageId`. Lo que sí es del repositorio —selección, diálogo,
 * historial— lo suelta `unload()` al desmontar la vista.
 */
export const useWorkingStore = create<WorkingState & WorkingActions>((set) => ({
  ...freshState(),

  setRefsCollapsed: (refsCollapsed) => {
    set({ refsCollapsed });
  },

  setDetailsCollapsed: (detailsCollapsed) => {
    set({ detailsCollapsed });
  },

  setSelectedCommits: (selectedCommits) => {
    set((state) => ({
      selectedCommits,
      ...(state.fileHistory !== null &&
      (selectedCommits.size !== state.selectedCommits.size ||
        [...selectedCommits].some((sha) => !state.selectedCommits.has(sha)))
        ? { fileHistory: null, diff: null }
        : {}),
    }));
  },

  setFileSelection: (fileSelection) => {
    set({ fileSelection });
  },

  setSelectedRef: (selectedRef) => {
    set({ selectedRef });
  },

  openDialog: (dialog) => {
    set({ dialog });
  },

  closeDialog: () => {
    set({ dialog: null });
  },

  openFileHistory: (path, at, openLatest = false) => {
    set({
      fileHistory: {
        path,
        ...(at === undefined ? {} : { at }),
        ...(openLatest ? { openLatest } : {}),
      },
      diff: null,
      detailsCollapsed: false,
    });
  },

  closeFileHistory: () => {
    set({ fileHistory: null });
  },

  /*
   * A qué commit volver lo decide el store y no quien abre.
   *
   * Los cuatro sitios desde los que se abre un diff —Seguimiento, Stage, los
   * archivos de un commit y el historial de un archivo— no tienen por qué saber
   * qué había marcado en la tabla; el store sí. Y desde el historial no se
   * vuelve al grafo sino al propio historial, que sigue montado detrás — CU-19.
   */
  openDiff: ({ path, source }) => {
    set((state) => ({
      ...(state.fileHistory?.path === path && source.kind === 'commit'
        ? { fileHistory: { path, at: source.sha } }
        : {}),
      diff: {
        path,
        source,
        returnTo: state.fileHistory === null ? singleCommitOf(state.selectedCommits) : null,
      },
    }));
  },

  closeDiff: () => {
    set((state) => {
      const returnTo = state.diff?.returnTo ?? null;

      // Se reutiliza `goTo`, el mismo mecanismo de «Ir a su nodo» de F2.4: la
      // tabla ya sabe llevar una fila al centro, y un segundo camino para lo
      // mismo serían dos formas de desplazarla que mantener de acuerdo.
      return returnTo === null
        ? { diff: null }
        : { diff: null, goTo: { sha: returnTo, nonce: (state.goTo?.nonce ?? 0) + 1 } };
    });
  },

  setDiffOptions: (patch) => {
    set((state) => ({ diffOptions: { ...state.diffOptions, ...patch } }));
  },

  requestGoTo: (sha) => {
    set((state) => ({ goTo: { sha, nonce: (state.goTo?.nonce ?? 0) + 1 } }));
  },

  bumpHistory: () => {
    set((state) => ({ historyVersion: state.historyVersion + 1 }));
  },

  setNodeForm: (nodeForm) => {
    set({ nodeForm });
  },

  setFileView: (fileView) => {
    set({ fileView });
  },

  setFileTreeExpanded: (fileTreeExpanded) => {
    set({ fileTreeExpanded });
  },

  setFileSort: (fileSort) => {
    set({ fileSort });
  },

  setFileFilter: (fileFilter) => {
    set({ fileFilter });
  },

  requestFilterFocus: () => {
    set((state) => ({ filterFocus: state.filterFocus + 1 }));
  },

  openCompare: (compare) => {
    set({ compare });
  },

  closeCompare: () => {
    set({ compare: null });
  },

  openActionPreview: (actionPreview) => {
    set({ actionPreview });
  },

  closeActionPreview: () => {
    set({ actionPreview: null });
  },

  setCommitDraft: (patch) => {
    set((state) => ({
      commitDraft: {
        ...state.commitDraft,
        ...patch,
        summary: normalizeCommitSummary(patch.summary ?? state.commitDraft.summary).slice(
          0,
          SUMMARY_LIMIT,
        ),
        body: (patch.body ?? state.commitDraft.body).slice(0, BODY_LIMIT),
      },
    }));
  },

  clearCommitDraft: () => {
    set({ commitDraft: { summary: '', body: '', amend: false } });
  },

  setWipName: (name) => {
    set({ wipName: name === '' ? null : name });
  },

  requestCommit: (amend) => {
    set((state) => ({
      ...(amend
        ? {
            selectedCommits: new Set<string>(),
            compare: null,
            diff: null,
            fileHistory: null,
            detailsCollapsed: false,
          }
        : {}),
      commitRequest: { amend, nonce: (state.commitRequest?.nonce ?? 0) + 1 },
    }));
  },

  clearCommitRequest: () => {
    set({ commitRequest: null });
  },

  requestFileAction: (kind, paths) => {
    set((state) => ({
      fileRequest: { kind, paths, nonce: (state.fileRequest?.nonce ?? 0) + 1 },
    }));
  },

  clearFileRequest: () => {
    set({ fileRequest: null });
  },

  requestCheckout: (target, name) => {
    set((state) => ({
      checkoutRequest: { target, name, nonce: (state.checkoutRequest?.nonce ?? 0) + 1 },
    }));
  },

  clearCheckoutRequest: () => {
    set({ checkoutRequest: null });
  },

  requestUndo: () => {
    set((state) => ({ undoRequest: state.undoRequest + 1 }));
  },

  requestRedo: () => {
    set((state) => ({ redoRequest: state.redoRequest + 1 }));
  },

  requestStash: () => {
    set((state) => ({ stashRequest: state.stashRequest + 1 }));
  },

  requestPop: () => {
    set((state) => ({
      popRequest: state.popRequest + 1,
      popTarget:
        state.selectedCommits.size === 1
          ? (state.context?.stashes?.find((stash) =>
              state.selectedCommits.has(`stash:${String(stash.index)}`),
            ) ?? null)
          : null,
    }));
  },

  requestContinue: () => {
    set((state) => ({ continueRequest: state.continueRequest + 1 }));
  },

  requestAbort: () => {
    set((state) => ({ abortRequest: state.abortRequest + 1 }));
  },

  requestFetch: () => {
    set((state) => ({ fetchRequest: state.fetchRequest + 1 }));
  },

  requestPull: () => {
    set((state) => ({ pullRequest: state.pullRequest + 1 }));
  },

  requestPush: () => {
    set((state) => ({ pushRequest: state.pushRequest + 1 }));
  },

  requestCancelNetwork: () => {
    set((state) => ({ cancelNetworkRequest: state.cancelNetworkRequest + 1 }));
  },

  setNetworkBusy: (networkBusy) => {
    set({ networkBusy });
  },

  setNetworkProgress: (networkProgress) => {
    set({ networkProgress });
  },

  requestNetworkFocus: (networkFocusGesture) => {
    set((state) => ({
      networkFocusGesture,
      networkFocusRequest: state.networkFocusRequest + 1,
    }));
  },

  openPushRejected: (pushRejected) => {
    set({ pushRejected });
  },

  closePushRejected: () => {
    set({ pushRejected: null });
  },

  setContext: (context) => {
    set({ context });
  },

  setRefColors: (refColors) => {
    set({ refColors });
  },

  /*
   * Lo que se suelta al cambiar de pestaña es lo que apunta a **este**
   * repositorio: las tres selecciones —commits, archivos y referencia—, el
   * diálogo, el historial, la comparación abierta, las peticiones sin atender y
   * el mensaje a medio escribir. El filtro de archivos también, porque una
   * lista filtrada por «roles.css» en otro repositorio se leería como una lista
   * vacía. El modo lista/árbol y el criterio de orden se quedan: son preferencia
   * de la persona, como el plegado de los dos paneles — y por lo mismo se
   * quedan las opciones del visor: una o dos columnas es cómo se lee un diff, no
   * cuál.
   */
  unload: () => {
    set({
      selectedCommits: new Set(),
      fileSelection: null,
      selectedRef: null,
      fileRequest: null,
      checkoutRequest: null,
      dialog: null,
      fileHistory: null,
      diff: null,
      goTo: null,
      compare: null,
      actionPreview: null,
      fileFilter: '',
      commitDraft: { summary: '', body: '', amend: false },
      commitRequest: null,
      wipName: null,
      networkBusy: false,
      networkProgress: null,
      networkFocusRequest: 0,
      networkFocusGesture: 'working.fetch',
      pushRejected: null,
      context: null,
    });
  },

  reset: () => {
    set(freshState());
  },
}));
