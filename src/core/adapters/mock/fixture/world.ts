import { shortSha, type Sha } from '@core/domain/commit';
import type { Branch, RefsSnapshot, Remote, Stash, Tag } from '@core/domain/refs';
import type { RepoId, Repository, UndoEntry } from '@core/domain/repository';
import {
  sizeOfText,
  type ConflictContents,
  type FileChange,
  type WorkingStatus,
} from '@core/domain/status';

import { createRandom } from '../random';
import { buildHistory, countAhead, fileChange, type History } from './history';
import { baseLines, editedLines } from './content';

/**
 * El repositorio ficticio, completo.
 *
 * No es un puñado de datos de relleno: es la única realidad contra la que se va
 * a construir y pulir todo el frontend hasta el bloque 2, así que tiene que
 * contener todo lo que las vistas prometen enseñar — historia larga con
 * fusiones, ramas locales y remotas con divergencia real, tags anotados y
 * ligeros, guardados, worktrees, una operación a medias con archivos en
 * conflicto, y cambios binarios y de texto. Lo que no esté aquí es una vista
 * que se desarrolla a ciegas.
 */

export const DEFAULT_SEED = 20260726;

const DAY = 86_400_000;
/** El primer commit del repositorio falso, fijo para que nada dependa de hoy. */
const FIRST_COMMIT_AT = Date.UTC(2025, 8, 2, 9, 14);

/**
 * Las líneas preparadas de cada lado, agrupadas.
 *
 * Un archivo puede tener líneas añadidas (lado `new`) y líneas eliminadas
 * (lado `old`) preparadas a la vez; el total de ambos lados es lo que el visor
 * muestra como fracción del stage.
 */
export interface SidedLines {
  new: ReadonlySet<number>;
  old: ReadonlySet<number>;
}

/**
 * Qué parte de un archivo está preparada.
 *
 * `'all'` es el archivo entero, que es lo normal y lo único que un binario
 * admite. Cuando solo va un trozo, se guardan los números de línea de cada
 * lado del diff — `new` para las añadidas, `old` para las eliminadas.
 */
export type StagedPart = 'all' | SidedLines;

/**
 * Un peldaño de la pila de deshacer.
 *
 * Guarda el repositorio **entero** tal y como estaba antes de la mutación, y no
 * un parche que sepa desandarla. Es lo que el reflog hace de verdad —apunta a
 * dónde estaba HEAD y deja que el objeto viejo siga ahí— y lo que evita escribir
 * una inversa por cada operación, que sería la mitad del código y todo el riesgo
 * de que una de ellas no cuadre.
 */
export interface UndoStep {
  entry: UndoEntry;
  before: MockRepo;
}

export interface MockRepo {
  repository: Repository;
  history: History;
  refs: RefsSnapshot;
  status: WorkingStatus;
  conflicts: ReadonlyMap<string, ConflictContents>;
  /** Estado anterior a reaplicar un stash, separado de la integración ya concluida. */
  stashRecovery?: {
    kind: NonNullable<WorkingStatus['recoveryOperation']>;
    target: Sha;
    before: MockRepo;
  };
  /** Patrones por alcance: repetir uno del mismo tipo no escribe nada. */
  ignored: readonly { pattern: string; kind: 'path' | 'extension' }[];
  staging: ReadonlyMap<string, StagedPart>;
  /**
   * El texto con el que se resolvió cada conflicto.
   *
   * Es lo que el archivo tiene en el árbol de trabajo después de resolverlo, y
   * lo que `unresolveConflict` tira para devolverlo a conflicto. **No guarda de
   * dónde vino cada trozo**: eso lo recuerda la vista mientras dura la sesión,
   * que es lo que `autoResolve` devuelve y lo único que necesita la lista.
   */
  resolved: ReadonlyMap<string, string>;
  /**
   * Las líneas del árbol de trabajo que ya se descartaron, por su lado y número
   * en el diff — la misma unidad que `staging`. Una vez aquí, salen del total
   * de `allLinesOf`: no se pueden volver a preparar ni a descartar.
   */
  discarded: ReadonlyMap<string, SidedLines>;
  /** La más reciente primero, que es como se deshace. */
  undoStack: readonly UndoStep[];
  redoStack: readonly UndoStep[];
  /**
   * El repositorio antes de la operación que se quedó a medias.
   *
   * Es lo que abortar restaura, y es lo que git guarda de verdad en `ORIG_HEAD`
   * y en el índice de la fusión. `null` cuando no hay nada a medias — o cuando
   * la operación viene puesta desde la semilla, como en `bitacora`, que nació
   * en conflicto y no tiene un antes al que volver.
   */
  beforeOperation: MockRepo | null;
}

/**
 * Lo que cambia de un repositorio y no viene de la semilla.
 *
 * Un archivo que nace preparado lo está entero; nadie empieza con medio hunk en
 * el stage. El resto se llena al escribir, sobre la copia del mundo. Las dos
 * pilas nacen vacías porque el mundo generado no es el resultado de que nadie
 * hiciera nada: deshacer solo alcanza a lo que se hizo dentro de GitThul.
 */
export function mutableState(
  status: WorkingStatus,
): Pick<
  MockRepo,
  'ignored' | 'staging' | 'resolved' | 'discarded' | 'undoStack' | 'redoStack' | 'beforeOperation'
> {
  return {
    ignored: [],
    staging: new Map(status.staged.map((change) => [change.path, 'all' as const])),
    resolved: new Map(),
    discarded: new Map(),
    undoStack: [],
    redoStack: [],
    beforeOperation: null,
  };
}

/** El árbol sin nada que enseñar, que es como nace y como queda un clon. */
const CLEAN_STATUS: WorkingStatus = {
  staged: [],
  unstaged: [],
  conflicted: [],
  clean: true,
};

export interface MockWorld {
  repos: ReadonlyMap<RepoId, MockRepo>;
  /** El orden en que se conocieron, que es el de la lista sin ordenar. */
  order: readonly RepoId[];
}

const GITTHUL_PATH = '/home/example/projects/gitthul';
const WORKTREE_PATH = '/home/example/projects/gitthul-f2-grafo';
const GRAPH_BRANCH = 'f2-3-motor-del-grafo';

export function buildWorld(seed: number = DEFAULT_SEED): MockWorld {
  const repos = new Map<RepoId, MockRepo>();
  const gitthul = buildGitthul(seed);

  repos.set('gitthul', gitthul);
  repos.set('gitthul-worktree', buildWorktreeOf(gitthul));
  repos.set('bitacora', buildBitacora(seed));
  repos.set('dotfiles', buildDotfiles(seed));

  return { repos, order: [...repos.keys()] };
}

/** El repositorio grande: historia larga, ramas vivas, guardados y worktree. */
function buildGitthul(seed: number): MockRepo {
  const history = buildHistory({
    seed,
    target: 300,
    mainBranch: 'main',
    openBranches: ['dev', GRAPH_BRANCH, 'fix/push-rechazado'],
    stashCount: 2,
    startAt: FIRST_COMMIT_AT,
  });

  const branches = branchesFrom(history, 'main', 'origin', {
    [GRAPH_BRANCH]: WORKTREE_PATH,
  });

  const tags = tagsFrom(history, seed);
  const head = history.tips.get('main') ?? '';

  const status: WorkingStatus = {
    staged: [
      fileChange('src/core/ports/GitPort.ts', 'added', seed + 1),
      fileChange('src/app/shellStore.ts', 'modified', seed + 2),
    ],
    unstaged: [
      fileChange('docs/inventario.md', 'modified', seed + 3),
      fileChange('src/design/roles.css', 'modified', seed + 4),
      fileChange('src/core/adapters/mock/mockGitPort.ts', 'untracked', seed + 5),
      fileChange('brand/icons/512x512.png', 'modified', seed + 6),
    ],
    conflicted: [],
    clean: false,
  };

  const refs: RefsSnapshot = {
    head: { branch: 'main', sha: head, detached: false },
    branches,
    tags,
    stashes: stashesFrom(history),
    worktrees: [
      {
        path: GITTHUL_PATH,
        name: 'gitthul',
        branch: 'main',
        head,
        isMain: true,
        locked: false,
        missing: false,
      },
      {
        path: WORKTREE_PATH,
        name: 'gitthul-f2-grafo',
        branch: GRAPH_BRANCH,
        head: history.tips.get(GRAPH_BRANCH) ?? head,
        isMain: false,
        locked: false,
        missing: false,
      },
    ],
    remotes: [
      {
        name: 'origin',
        fetchUrl: 'https://ejemplo.org/alex/gitthul.git',
        pushUrl: 'https://ejemplo.org/alex/gitthul.git',
      },
    ],
  };

  return {
    repository: {
      id: 'gitthul',
      name: 'gitthul',
      path: GITTHUL_PATH,
      head: 'main',
      lastOpenedAt: FIRST_COMMIT_AT + 320 * DAY,
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

/** El worktree que el repositorio grande ya trae puesto, con su fecha de uso. */
function buildWorktreeOf(parent: MockRepo): MockRepo {
  const worktree = buildWorktreeRepo(parent, {
    id: 'gitthul-worktree',
    name: 'gitthul',
    path: WORKTREE_PATH,
    branch: GRAPH_BRANCH,
    head: parent.history.tips.get(GRAPH_BRANCH) ?? parent.refs.head.sha,
    status: {
      staged: [],
      unstaged: [fileChange('src/features/working/graphLayout.ts', 'modified', 77)],
      conflicted: [],
      clean: false,
    },
  });

  return {
    ...worktree,
    repository: { ...worktree.repository, lastOpenedAt: FIRST_COMMIT_AT + 318 * DAY },
  };
}

export interface WorktreeSpec {
  id: RepoId;
  name: string;
  path: string;
  branch: string;
  head: Sha;
  /** El del fixture nace con un archivo tocado; el que se crea al vuelo, limpio. */
  status?: WorkingStatus;
}

/**
 * Un worktree, como el repositorio aparte que la lista enseña.
 *
 * Comparte historia y referencias con su padre —son el mismo repositorio— pero
 * tiene su propia rama activa y su propio árbol de trabajo, que es justo lo que
 * hace falta para poder tener las dos pestañas abiertas a la vez. Vive aquí y
 * no en el adaptador porque el del fixture y el que crea `createWorktree` tienen
 * que salir con la misma forma o la vista vería dos cosas distintas.
 */
export function buildWorktreeRepo(parent: MockRepo, spec: WorktreeSpec): MockRepo {
  const status = spec.status ?? CLEAN_STATUS;

  return {
    repository: {
      id: spec.id,
      name: spec.name,
      path: spec.path,
      head: spec.branch,
      lastOpenedAt: null,
      remotes: parent.refs.remotes,
      operation: { kind: 'none' },
      bare: false,
      hasSubmodules: false,
      worktreeOf: parent.repository.id,
    },
    history: parent.history,
    refs: { ...parent.refs, head: { branch: spec.branch, sha: spec.head, detached: false } },
    status,
    conflicts: new Map(),
    ...mutableState(status),
  };
}

/** El repositorio con una fusión a medias: el que sostiene la vista Resolver. */
function buildBitacora(seed: number): MockRepo {
  const history = buildHistory({
    seed: seed + 101,
    target: 45,
    mainBranch: 'main',
    openBranches: ['redaccion'],
    stashCount: 1,
    startAt: FIRST_COMMIT_AT + 40 * DAY,
  });

  const head = history.tips.get('main') ?? '';

  /*
   * Las seis clases de conflicto, más los tres casos que la vista tiene que
   * saber distinguir: el binario, el que pasa del tope y el que la
   * autoresolución puede cerrar sola. Sin los tres, media Resolver sería un
   * camino sin recorrer.
   */
  const conflicted: readonly FileChange[] = [
    { ...fileChange('docs/plan.md', 'conflicted', seed + 11), conflict: 'bothModified' },
    { ...fileChange('src/design/palette.css', 'conflicted', seed + 12), conflict: 'bothModified' },
    { ...fileChange('brand/icons/icon.ico', 'conflicted', seed + 13), conflict: 'bothAdded' },
    { ...fileChange('README.md', 'conflicted', seed + 14), conflict: 'deletedByThem' },
    { ...fileChange('src/legacy/antiguo.ts', 'conflicted', seed + 16), conflict: 'deletedByUs' },
    { ...fileChange('docs/notas.md', 'conflicted', seed + 17), conflict: 'addedByUs' },
    { ...fileChange('docs/hoja-de-ruta.md', 'conflicted', seed + 18), conflict: 'addedByThem' },
    { ...fileChange(HUGE_CONFLICT_PATH, 'conflicted', seed + 19), conflict: 'bothModified' },
    { ...fileChange(IDENTICAL_CONFLICT_PATH, 'conflicted', seed + 20), conflict: 'bothModified' },
  ];

  const status: WorkingStatus = {
    staged: [fileChange('docs/inventario.md', 'modified', seed + 15)],
    unstaged: [],
    conflicted,
    clean: false,
  };

  return {
    repository: {
      id: 'bitacora',
      name: 'bitacora',
      path: '/home/example/projects/bitacora',
      head: 'main',
      lastOpenedAt: FIRST_COMMIT_AT + 300 * DAY,
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://ejemplo.org/alex/bitacora.git',
          pushUrl: 'https://ejemplo.org/alex/bitacora.git',
        },
      ],
      operation: { kind: 'merge', source: 'redaccion', target: 'main' },
      bare: false,
      hasSubmodules: true,
    },
    history,
    refs: {
      head: { branch: 'main', sha: head, detached: false },
      branches: branchesFrom(history, 'main', 'origin', {}),
      tags: [],
      stashes: stashesFrom(history),
      worktrees: [
        {
          path: '/home/example/projects/bitacora',
          name: 'bitacora',
          branch: 'main',
          head,
          isMain: true,
          locked: false,
          missing: false,
        },
      ],
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://ejemplo.org/alex/bitacora.git',
          pushUrl: 'https://ejemplo.org/alex/bitacora.git',
        },
      ],
    },
    status,
    conflicts: new Map(
      conflicted.map((change) => [change.path, conflictFor(change, 'main', 'redaccion')]),
    ),
    ...mutableState(status),
  };
}

/** El repositorio pequeño y limpio, con HEAD desacoplado sobre un tag. */
function buildDotfiles(seed: number): MockRepo {
  const history = buildHistory({
    seed: seed + 202,
    target: 25,
    mainBranch: 'main',
    openBranches: [],
    stashCount: 0,
    startAt: FIRST_COMMIT_AT + 120 * DAY,
  });

  const detachedAt = history.mainline[Math.max(0, history.mainline.length - 4)] ?? '';

  return {
    repository: {
      id: 'dotfiles',
      name: 'dotfiles',
      path: '/home/example/dotfiles',
      head: shortSha(detachedAt),
      lastOpenedAt: null,
      remotes: [],
      operation: { kind: 'none' },
      bare: false,
      hasSubmodules: false,
    },
    history,
    refs: {
      head: { branch: null, sha: detachedAt, detached: true },
      branches: branchesFrom(history, 'main', null, {}),
      tags: [
        {
          id: 'refs/tags/v3',
          name: 'v3',
          target: detachedAt,
          annotated: false,
        },
      ],
      stashes: [],
      worktrees: [
        {
          path: '/home/example/dotfiles',
          name: 'dotfiles',
          branch: 'main',
          head: history.tips.get('main') ?? '',
          isMain: true,
          locked: false,
          missing: false,
        },
      ],
      remotes: [],
    },
    status: CLEAN_STATUS,
    conflicts: new Map(),
    ...mutableState(CLEAN_STATUS),
  };
}

/**
 * Las ramas locales y sus remotas, con lo que llevan de más y de menos.
 *
 * `ahead` y `behind` se cuentan recorriendo el grafo de verdad: es el dato que
 * decide si el botón dice «subir 3» o «traer 2», y desarrollarlo contra un
 * número inventado sería desarrollarlo contra algo imposible.
 */
function branchesFrom(
  history: History,
  headBranch: string,
  remote: string | null,
  checkedOutIn: Readonly<Record<string, string>>,
): readonly Branch[] {
  const branches: Branch[] = [];

  for (const [name, tip] of history.tips) {
    const remoteTip = remote ? history.remoteTips.get(name) : undefined;
    const upstream = remote && remoteTip ? `${remote}/${name}` : undefined;

    branches.push({
      id: `refs/heads/${name}`,
      name,
      kind: 'local',
      tip,
      ...(upstream === undefined ? {} : { upstream }),
      ahead: remoteTip ? countAhead(history.byShaLookup, tip, remoteTip) : 0,
      behind: remoteTip ? countAhead(history.byShaLookup, remoteTip, tip) : 0,
      isHead: name === headBranch,
      ...(checkedOutIn[name] === undefined ? {} : { checkedOutIn: checkedOutIn[name] }),
    });

    if (remote && remoteTip) {
      branches.push({
        id: `refs/remotes/${remote}/${name}`,
        name: `${remote}/${name}`,
        kind: 'remote',
        remote,
        tip: remoteTip,
        ahead: 0,
        behind: 0,
        isHead: false,
      });
    }
  }

  return branches;
}

/** Tres tags sobre la línea principal: dos anotados y uno ligero. */
function tagsFrom(history: History, seed: number): readonly Tag[] {
  const random = createRandom(seed + 7);
  const points = [0.35, 0.62, 0.88].map(
    (fraction) => history.mainline[Math.floor(history.mainline.length * fraction)] ?? '',
  );

  const names = ['v0.1.0', 'v0.1.1', 'v0.2.0-rc.1'];

  return points.map((target, index) => {
    const annotated = index < 2;
    const at = history.byShaLookup.get(target)?.committedAt ?? FIRST_COMMIT_AT;

    return {
      id: `refs/tags/${names[index] ?? 'v0'}`,
      name: names[index] ?? 'v0',
      target,
      annotated,
      ...(annotated
        ? {
            message: `Versión ${names[index] ?? ''} — bloque 0 completo`,
            tagger: { name: 'Alex', email: 'alex@ejemplo.org' },
            taggedAt: at + random.int(1, 20) * 3_600_000,
          }
        : {}),
    };
  });
}

function stashesFrom(history: History): readonly Stash[] {
  return history.stashes.map((stash, index) => ({ index, ...stash }));
}

/**
 * El conflicto que pasa del tope del resolutor y el que se resuelve solo.
 *
 * Van por ruta y no por una marca en `FileChange` porque son propiedades del
 * conflicto y no del cambio: el mismo archivo, fuera de una fusión, no tiene
 * nada de especial. Las cifras del grande están por encima de
 * `CONFLICT_TEXT_LIMIT` a propósito, y son las que la ficha enseña.
 */
export const HUGE_CONFLICT_PATH = 'assets/traducciones.po';
export const HUGE_CONFLICT_SIZE = { bytes: 7_340_032, lines: 61_240 };
export const IDENTICAL_CONFLICT_PATH = '.gitignore';

/**
 * Las tres versiones de un archivo en conflicto.
 *
 * Cada lado sale del mismo generador que el resto del contenido falso, con
 * semillas distintas: así los dos paneles superiores del resolutor enseñan
 * textos parecidos pero no iguales, que es exactamente el caso difícil.
 *
 * Las etiquetas de los dos lados llegan de fuera porque un conflicto no sabe
 * de qué operación viene: la fusión del fixture dice `main` y `redaccion`, y el
 * que deja un cherry-pick dice el SHA que se trajo. La invariante 5 pide que
 * cada lado se nombre, y nombrarlos aquí sería nombrarlos siempre igual.
 */
export function conflictFor(change: FileChange, ours: string, theirs: string): ConflictContents {
  const kind = change.conflict ?? 'bothModified';

  /*
   * El archivo que pasa del tope no genera texto **ni aquí**: es lo que el
   * puerto de verdad hará —devolver las cifras y no cargar el contenido— y
   * fingirlo generando siete megas de líneas inventadas convertiría una prueba
   * barata en la más cara del repositorio.
   */
  if (change.path === HUGE_CONFLICT_PATH) {
    return {
      path: change.path,
      kind,
      base: null,
      ours: null,
      theirs: null,
      oursLabel: ours,
      theirsLabel: theirs,
      sizes: { ours: HUGE_CONFLICT_SIZE, theirs: HUGE_CONFLICT_SIZE },
      binary: change.binary,
      tooLarge: true,
    };
  }

  // Un conflicto de tres vías reproducible: dos decisiones reales y una
  // inserción compatible. Las semillas independientes podían generar cambios
  // disjuntos que Git combinaría sin conflicto, aunque la lista dijera lo contrario.
  if (change.path === 'docs/plan.md' && kind === 'bothModified') {
    const base =
      '# Plan\n\n## Objetivo\nPublicar la versión inicial.\n\n## Validación\nRevisar el flujo principal.\n\n## Entrega\nPreparar el paquete.\n';
    const oursText = base
      .replace('Publicar la versión inicial.', 'Publicar la versión estable.')
      .replace('Revisar el flujo principal.', 'Probar todos los flujos.')
      .replace('Preparar el paquete.', 'Preparar el paquete.\nGenerar las notas de versión.');
    const theirsText = base
      .replace('Publicar la versión inicial.', 'Publicar una versión de prueba.')
      .replace('Revisar el flujo principal.', 'Revisar los flujos con usuarios.');
    return {
      path: change.path,
      kind,
      base,
      ours: oursText,
      theirs: theirsText,
      oursLabel: ours,
      theirsLabel: theirs,
      sizes: { ours: sizeOfText(oursText), theirs: sizeOfText(theirsText) },
      binary: false,
      tooLarge: false,
    };
  }

  const base = baseLines(change.path).join('\n');

  // Los dos lados escribieron exactamente lo mismo: es de lo poco que se puede
  // resolver solo sin arriesgarse a acertar mal.
  const sideKey = (side: 'ours' | 'theirs') =>
    change.path === IDENTICAL_CONFLICT_PATH ? 'ambos' : side;

  const oursText =
    kind === 'deletedByUs' || kind === 'addedByThem' || kind === 'bothDeleted'
      ? null
      : editedLines(change.path, sideKey('ours')).lines.join('\n');
  const theirsText =
    kind === 'deletedByThem' || kind === 'addedByUs' || kind === 'bothDeleted'
      ? null
      : editedLines(change.path, sideKey('theirs')).lines.join('\n');

  return {
    path: change.path,
    kind,
    base: kind === 'bothAdded' || kind === 'addedByUs' || kind === 'addedByThem' ? null : base,
    ours: oursText,
    theirs: theirsText,
    oursLabel: ours,
    theirsLabel: theirs,
    sizes: { ours: sizeOfText(oursText), theirs: sizeOfText(theirsText) },
    binary: change.binary,
    tooLarge: false,
  };
}

/** Los archivos que tocó un commit; los de fusión pueden no tocar ninguno. */
export function filesOf(history: History, sha: Sha): readonly FileChange[] {
  return history.filesBySha.get(sha) ?? [];
}

const EMPTY_HISTORY: History = {
  commits: [],
  byShaLookup: new Map(),
  filesBySha: new Map(),
  tips: new Map(),
  remoteTips: new Map(),
  stashes: [],
  mainline: [],
};

export interface NewRepoSpec {
  id: RepoId;
  name: string;
  path: string;
  initialBranch: string;
}

/**
 * El repositorio recién creado.
 *
 * Cero commits, y por tanto **cero ramas**: la rama inicial existe como nombre
 * de HEAD pero todavía no es una referencia, que es exactamente lo que hace
 * `git init`. La vista tiene que saber pintar eso —el panel de estadísticas dice
 * que aún no hay historia— y solo lo sabrá si el falso no le inventa un commit
 * de cortesía.
 */
export function buildNewRepo(spec: NewRepoSpec): MockRepo {
  return {
    repository: {
      id: spec.id,
      name: spec.name,
      path: spec.path,
      head: spec.initialBranch,
      lastOpenedAt: null,
      remotes: [],
      operation: { kind: 'none' },
      bare: false,
      hasSubmodules: false,
    },
    history: EMPTY_HISTORY,
    refs: {
      head: { branch: spec.initialBranch, sha: '', detached: false },
      branches: [],
      tags: [],
      stashes: [],
      worktrees: [
        {
          path: spec.path,
          name: spec.name,
          branch: spec.initialBranch,
          head: '',
          isMain: true,
          locked: false,
          missing: false,
        },
      ],
      remotes: [],
    },
    status: CLEAN_STATUS,
    conflicts: new Map(),
    ...mutableState(CLEAN_STATUS),
  };
}

export interface ExistingRepoSpec extends NewRepoSpec {
  seed: number;
  /** Con dirección hay `origin`; sin ella, un repositorio solo local. */
  url?: string;
}

/**
 * El repositorio que ya existía: el que se clona o el que se adopta del disco.
 *
 * A diferencia del creado, este llega con historia: adoptar una carpeta vacía de
 * commits sería un caso rarísimo y dejaría la vista sin nada que enseñar justo
 * después de la operación más larga del puerto. El árbol queda limpio y la rama
 * al día con su remoto, que es como termina un clon de verdad.
 */
export function buildExistingRepo(spec: ExistingRepoSpec): MockRepo {
  const history = buildHistory({
    seed: spec.seed,
    target: 40,
    mainBranch: spec.initialBranch,
    openBranches: [],
    stashCount: 0,
    startAt: FIRST_COMMIT_AT + 60 * DAY,
  });

  const head = history.tips.get(spec.initialBranch) ?? '';
  const remotes = spec.url
    ? [{ name: 'origin', fetchUrl: spec.url, pushUrl: spec.url }]
    : ([] as readonly Remote[]);

  // Recién clonada, la local y su remota apuntan al mismo commit: nada por subir
  // y nada por traer. `branchesFrom` no sirve aquí porque su remoto se queda
  // unos commits atrás a propósito, que es el caso del repositorio en uso.
  const local: Branch = {
    id: `refs/heads/${spec.initialBranch}`,
    name: spec.initialBranch,
    kind: 'local',
    tip: head,
    ...(spec.url ? { upstream: `origin/${spec.initialBranch}` } : {}),
    ahead: 0,
    behind: 0,
    isHead: true,
  };

  const branches: readonly Branch[] = spec.url
    ? [
        local,
        {
          id: `refs/remotes/origin/${spec.initialBranch}`,
          name: `origin/${spec.initialBranch}`,
          kind: 'remote',
          remote: 'origin',
          tip: head,
          ahead: 0,
          behind: 0,
          isHead: false,
        },
      ]
    : [local];

  return {
    repository: {
      id: spec.id,
      name: spec.name,
      path: spec.path,
      head: spec.initialBranch,
      lastOpenedAt: null,
      remotes,
      operation: { kind: 'none' },
      bare: false,
      hasSubmodules: false,
    },
    history,
    refs: {
      head: { branch: spec.initialBranch, sha: head, detached: false },
      branches,
      tags: [],
      stashes: [],
      worktrees: [
        {
          path: spec.path,
          name: spec.name,
          branch: spec.initialBranch,
          head,
          isMain: true,
          locked: false,
          missing: false,
        },
      ],
      remotes,
    },
    status: CLEAN_STATUS,
    conflicts: new Map(),
    ...mutableState(CLEAN_STATUS),
  };
}
