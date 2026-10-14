import {
  shortSha,
  type Commit,
  type CommitDetails,
  type CommitPage,
  type CommitPageRequest,
  type CommitRequest,
  type Person,
  type Sha,
} from '@core/domain/commit';
import type { DiffRequest, DiffSource, FileContents, FileDiff, Hunk } from '@core/domain/diff';
import { GitOperationError } from '@core/domain/errors';
import {
  refsAt,
  type Branch,
  type IntegrationPreview,
  type Remote,
  type RefsSnapshot,
  type RefTarget,
  type ResetMode,
  type Worktree,
} from '@core/domain/refs';
import type {
  RepoId,
  RepoOperation,
  Repository,
  RepoSummary,
  TransferProgress,
  UndoEntry,
} from '@core/domain/repository';
import type {
  ConflictContents,
  ConflictKind,
  FileChange,
  Resolution,
  TreeEntry,
  WorkingStatus,
} from '@core/domain/status';
import type {
  LineSide,
  LineRef,
  CloneProgress,
  CloneRequest,
  GitPort,
  GitQuery,
} from '@core/ports/GitPort';

import { baseLines, editedLines, hunksFromEdits } from './fixture/content';
import { isMockRepositoryDirectory } from './fixture/directories';
import { countAhead, fileChange, type History } from './fixture/history';
import { describePath, MERGE_TEMPLATE, PATHS } from './fixture/vocabulary';
import {
  buildExistingRepo,
  buildNewRepo,
  buildWorktreeRepo,
  buildWorld,
  conflictFor,
  DEFAULT_SEED,
  filesOf,
  type MockRepo,
  type SidedLines,
  type StagedPart,
} from './fixture/world';
import { reinterpretPreview } from './textDecoding';
import { DEFAULT_LATENCY, wait, type LatencyRange } from './latency';
import { createRandom, seedFrom } from './random';

export interface MockGitPortOptions {
  seed?: number;
  /** Las pruebas pasan `NO_LATENCY`; el desarrollo se queda con la de verdad. */
  latency?: LatencyRange;
}

/** Las operaciones a las que se les puede encargar un fallo. */
export type MockGitOperation =
  | 'openRepository'
  | 'createRepository'
  | 'cloneRepository'
  | 'forgetRepository'
  | 'markOpened'
  | 'stage'
  | 'unstage'
  | 'stageHunks'
  | 'unstageHunks'
  | 'stageLines'
  | 'unstageLines'
  | 'discardAll'
  | 'discard'
  | 'discardLines'
  | 'resolveConflict'
  | 'markConflictResolved'
  | 'markConflictsResolved'
  | 'unresolveConflict'
  | 'keepSide'
  | 'autoResolve'
  | 'ignorePath'
  | 'commit'
  | 'createBranch'
  | 'renameBranch'
  | 'deleteBranch'
  | 'setUpstream'
  | 'createTag'
  | 'deleteTag'
  | 'checkout'
  | 'createStash'
  | 'renameStash'
  | 'applyStash'
  | 'dropStash'
  | 'merge'
  | 'rebase'
  | 'cherryPick'
  | 'revert'
  | 'reset'
  | 'continueOperation'
  | 'abortOperation'
  | 'quitOperation'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'addRemote'
  | 'updateRemote'
  | 'removeRemote'
  | 'createWorktree'
  | 'removeWorktree'
  | 'lockWorktree'
  | 'undo'
  | 'redo';

export interface MockGitPort extends GitPort {
  /**
   * Encarga que el próximo intento de una operación falle.
   *
   * Los fallos que el falso puede decidir por sí mismo —una carpeta sin git, una
   * dirección que no se entiende, un destino ocupado— no hacen falta aquí: los
   * lanza solo. Esto es para los que dependen del mundo y no del argumento, como
   * que el remoto rechace las credenciales, de modo que la vista pueda pintar su
   * panel de error en una prueba sin trucos.
   */
  failNext: (operation: MockGitOperation, error: GitOperationError) => void;
}

const DEFAULT_CONTEXT = 3;

/** Lo que el falso acepta como dirección de repositorio. */
const CLONE_URL =
  /^(https?:\/\/[^\s/]+\/\S+|ssh:\/\/\S+|git:\/\/\S+|file:\/\/\S+|[\w.-]+@[\w.-]+:\S+|\/\S+)$/;

/** El registro de repositorios, que a diferencia del mundo sí cambia. */
interface MockRegistry {
  repos: Map<RepoId, MockRepo>;
  /** El orden en que se conocieron. Dar de alta añade al final. */
  order: RepoId[];
}

/**
 * El adaptador falso de git.
 *
 * Implementa `GitPort` entero contra un repositorio inventado, y es lo que
 * permite construir y pulir el frontend completo sin una línea de Rust. Tres
 * decisiones lo gobiernan:
 *
 * - **El mundo se construye la primera vez que alguien pregunta.** Trescientos
 *   commits son baratos, pero no lo bastante como para pagarlos al importar el
 *   módulo: el contexto de puertos se crea al arrancar y la galería de tokens
 *   no necesita ni un commit.
 * - **Todo tarda un poco.** Sin latencia fingida, los esqueletos y los
 *   indicadores de carga serían código que nadie ve nunca — y con git de verdad
 *   nada es instantáneo.
 * - **El registro cambia y el mundo no.** Dar de alta y de baja repositorios
 *   ocurre sobre una copia del mundo generado, así que la historia sigue siendo
 *   la misma con la misma semilla por mucho que se creen y se olviden carpetas.
 */
export function createMockGitPort(options: MockGitPortOptions = {}): MockGitPort {
  const seed = options.seed ?? DEFAULT_SEED;
  const latency = options.latency ?? DEFAULT_LATENCY;
  const random = createRandom(seed ^ 0x5f5f);
  const programmed = new Map<MockGitOperation, GitOperationError[]>();

  let registry: MockRegistry | null = null;

  const load = (): MockRegistry => {
    if (registry) return registry;

    const world = buildWorld(seed);

    registry = { repos: new Map(world.repos), order: [...world.order] };

    return registry;
  };

  /** Espera lo que tardaría git y respeta la cancelación. */
  const settle = (query?: GitQuery) =>
    wait(latency.max === 0 ? 0 : random.int(latency.min, latency.max), query?.signal);

  /** Lanza el fallo encargado para esta operación, si había alguno pendiente. */
  const failIfProgrammed = (operation: MockGitOperation) => {
    const error = programmed.get(operation)?.shift();

    if (error) throw error;
  };

  const find = (id: RepoId): MockRepo => {
    const repo = load().repos.get(id);

    if (!repo) {
      throw new GitOperationError(
        'repo.notFound',
        { repo: id, path: id },
        { output: `fatal: no existe el repositorio ${id}` },
      );
    }

    return repo;
  };

  const at = (path: string): MockRepo | undefined =>
    [...load().repos.values()].find((repo) => repo.repository.path === path);

  /**
   * El repositorio, siempre que no tenga nada a medias.
   *
   * Integrar encima de una fusión sin terminar es lo que git no deja hacer, y
   * el error lo dice con las dos ramas: no hay «una operación en curso», hay la
   * fusión de `redaccion` dentro de `main` esperando a que alguien decida.
   */
  const busyOrThrow = (id: RepoId): MockRepo => {
    const repo = find(id);
    const operation = repo.repository.operation;

    if (operation.kind !== 'none' && operation.kind !== 'bisect') {
      throw new GitOperationError('operation.inProgress', {
        kind: operation.kind,
        source: operation.source,
        target: operation.target,
      });
    }

    return repo;
  };

  /** Da de baja el worktree que vivía en esa carpeta, si estaba en la lista. */
  const forgetAt = (path: string, parent: RepoId): void => {
    const child = at(path);

    if (!child || child.repository.worktreeOf !== parent) return;

    const { repos, order } = load();

    repos.delete(child.repository.id);
    order.splice(order.indexOf(child.repository.id), 1);
  };

  const register = (repo: MockRepo): Repository => {
    const { repos, order } = load();

    repos.set(repo.repository.id, repo);
    order.push(repo.repository.id);

    return repo.repository;
  };

  /*
   * Toda escritura pasa por aquí: recibe el repositorio ya mutado y lo deja en
   * el registro. Cuando la mutación era imposible, el ayudante devuelve el mismo
   * objeto y entonces no hay nada que guardar — la misma regla que `LibraryPort`
   * usa desde F0.9.
   */
  const store = (repo: MockRepo): MockRepo => {
    if (repo !== load().repos.get(repo.repository.id)) load().repos.set(repo.repository.id, repo);

    return repo;
  };

  /** Prepara o desprepara un archivo y devuelve el árbol resultante. */
  const restage = (id: RepoId, path: string, part: StagedPart | null): WorkingStatus =>
    store(
      remember(
        find(id),
        applyStaging(find(id), path, part),
        part === null ? 'undo.unstage' : 'undo.stage',
        {},
      ),
    ).status;

  /*
   * Anota la mutación en la pila de deshacer, guardando el repositorio entero
   * como estaba. Rehacer se vacía en cuanto se escribe algo nuevo: una pila con
   * dos futuros distintos no es una pila, es una adivinanza.
   */
  const remember = (
    previous: MockRepo,
    next: MockRepo,
    labelKey: string,
    params: Readonly<Record<string, string | number>>,
  ): MockRepo => {
    if (next === previous) return next;

    const entry: UndoEntry = {
      id: random.hex(8),
      labelKey,
      params,
      at: Date.now(),
      // El falso solo apunta lo que sabe desandar; el reflog de verdad tiene
      // además entradas que se leen y no se rehacen, y por eso existe el campo.
      undoable: true,
    };

    return {
      ...next,
      undoStack: [{ entry, before: previous }, ...previous.undoStack],
      redoStack: [],
    };
  };

  /**
   * Guarda el repositorio a medias y lanza el fallo que lo cuenta.
   *
   * El orden importa: la operación falla **y** deja el árbol en conflicto, que
   * es lo que hace git y lo que la vista Resolver necesita encontrarse. Escribir
   * después de lanzar dejaría el mundo limpio y la ventana diciendo que no.
   */
  const stopAt = (outcome: Integration): never => {
    store(outcome.repo);

    throw conflictErrorFor(outcome.repo.repository.operation, outcome.conflicts.length);
  };

  const identities = new Map<RepoId, Person>();
  return {
    integrationWritesAvailable: true,
    failNext: (operation, error) => {
      const queue = programmed.get(operation) ?? [];

      queue.push(error);
      programmed.set(operation, queue);
    },

    listRepositories: async (query) => {
      await settle(query);

      const { order } = load();

      return order.map((id) => summaryOf(find(id)));
    },

    openRepository: async (path, query) => {
      await settle(query);
      failIfProgrammed('openRepository');

      const known = at(path);

      if (known) {
        throw new GitOperationError('repo.alreadyExists', {
          repo: known.repository.name,
          path,
        });
      }

      if (!isMockRepositoryDirectory(path)) {
        throw new GitOperationError(
          'repo.notARepository',
          { path },
          {
            output: `fatal: not a git repository (or any of the parent directories): .git\n${path}`,
          },
        );
      }

      const name = basename(path);

      return register(
        buildExistingRepo({
          id: uniqueId(load(), name),
          name,
          path,
          initialBranch: 'main',
          seed: seedFrom(path),
        }),
      );
    },

    createRepository: async (path, { name, initialBranch }, query) => {
      await settle(query);
      failIfProgrammed('createRepository');

      const target = join(path, name);
      const known = at(target);

      if (known) {
        throw new GitOperationError('repo.alreadyExists', {
          repo: known.repository.name,
          path: target,
        });
      }

      return register(
        buildNewRepo({ id: uniqueId(load(), name), name, path: target, initialBranch }),
      );
    },

    /*
     * El clon es la única operación larga del puerto, así que es la única que
     * informa por etapas. La cuenta de objetos no se sabe mientras se cuentan
     * —ahí la barra va indeterminada— y se sabe en cuanto empiezan a llegar, que
     * es justo lo que la vista tiene que saber pintar de las dos maneras.
     */
    cloneRepository: async (request, query) => {
      await settle(query);
      failIfProgrammed('cloneRepository');

      if (!CLONE_URL.test(request.url.trim())) {
        throw new GitOperationError(
          'clone.invalidUrl',
          { url: request.url },
          { output: `fatal: repository '${request.url}' does not exist` },
        );
      }

      const target = join(request.path, request.name);

      if (at(target)) {
        throw new GitOperationError(
          'clone.destinationNotEmpty',
          { path: target },
          {
            output: `fatal: destination path '${target}' already exists and is not an empty directory.`,
          },
        );
      }

      const objects = createRandom(seedFrom(request.url)).int(400, 4_000);

      await progress(request, objects, () => settle(query));

      return register(
        buildExistingRepo({
          id: uniqueId(load(), request.name),
          name: request.name,
          path: target,
          initialBranch: 'main',
          seed: seedFrom(request.url),
          url: request.url.trim(),
        }),
      );
    },

    forgetRepository: async (id, query) => {
      await settle(query);
      failIfProgrammed('forgetRepository');

      const { repos, order } = load();

      find(id);
      repos.delete(id);
      order.splice(order.indexOf(id), 1);
    },

    markOpened: async (id, when, query) => {
      await settle(query);
      failIfProgrammed('markOpened');

      const repo = find(id);

      load().repos.set(id, {
        ...repo,
        repository: { ...repo.repository, lastOpenedAt: when ?? Date.now() },
      });
    },

    watchRepository: async (_id, _listener, query) => {
      await settle(query);
      return () => undefined;
    },

    readRepository: async (id, query) => {
      await settle(query);

      const normalized = id.replaceAll('\\', '/').replace(/\/+$/, '');
      const repository = [...load().repos.values()]
        .filter((candidate) => {
          const root = candidate.repository.path.replaceAll('\\', '/').replace(/\/+$/, '');
          return normalized === root || normalized.startsWith(`${root}/`);
        })
        .sort((left, right) => right.repository.path.length - left.repository.path.length)[0];
      if (!repository) return find(id).repository;
      return repository.repository;
    },

    readIdentity: async (id, query) => {
      await settle(query);
      find(id);
      return identities.get(id) ?? CONFIG_IDENTITY;
    },

    writeIdentity: async (id, identity, query) => {
      await settle(query);
      find(id);
      identities.set(id, identity);
      return identity;
    },
    readRefs: async (id, query) => {
      await settle(query);

      return find(id).refs;
    },

    readCommits: async (id, page, query) => {
      await settle(query);

      return pageOf(find(id), page);
    },

    readCommit: async (id, sha, query) => {
      await settle(query);

      const repo = find(id);
      const commit = repo.history.byShaLookup.get(sha);

      if (!commit) throw missingObject(repo.repository, sha);

      return {
        commit,
        files: filesOf(repo.history, sha),
        refs: refsAt(repo.refs, sha),
      } satisfies CommitDetails;
    },

    readStatus: async (id, query) => {
      await settle(query);

      return find(id).status;
    },

    readDiff: async (id, request, query) => {
      await settle(query);

      const file = diffOf(find(id), request);
      if (!request.encoding || request.encoding === 'auto' || file.content.kind !== 'text')
        return file;
      let decodingErrors = false;
      const hunks = file.content.hunks.map((hunk) => ({
        ...hunk,
        lines: hunk.lines.map((line) => {
          const decoded = reinterpretPreview(line.text, request.encoding);
          decodingErrors ||= decoded.decodingErrors;
          return { ...line, text: decoded.text, words: [] };
        }),
      }));
      return {
        ...file,
        content: {
          ...file.content,
          encoding: request.encoding,
          detectedEncoding: 'utf-8',
          decodingErrors,
          supportsPartial: request.encoding === 'utf-8',
          hunks,
        },
      };
    },

    readDiffFiles: async (id, source, query) => {
      await settle(query);
      return diffFilesOf(find(id), source);
    },

    readFile: async (id, path, at, query) => {
      await settle(query);

      const repo = find(id);

      const file = query?.blob ? indexContents(repo, path) : contentsOf(path, at ?? 'worktree');
      return file.text === null || !query?.encoding || query.encoding === 'auto'
        ? file
        : { ...file, ...reinterpretPreview(file.text, query.encoding), detectedEncoding: 'utf-8' };
    },

    readConflict: async (id, path, query) => {
      await settle(query);

      const repo = find(id);
      const conflict = repo.conflicts.get(path);

      if (!conflict) {
        throw new GitOperationError(
          'unknown',
          {},
          { output: `El archivo ${path} no está en conflicto en ${repo.repository.name}` },
        );
      }

      let decodingErrors = false;
      const decode = (text: string | null) => {
        if (text === null) return null;
        const decoded = reinterpretPreview(text, query?.encoding);
        decodingErrors ||= decoded.decodingErrors;
        return decoded.text;
      };
      const contents = {
        base: decode(conflict.base),
        ours: decode(conflict.ours),
        theirs: decode(conflict.theirs),
      };
      return {
        ...conflict,
        ...contents,
        encoding: !query?.encoding || query.encoding === 'auto' ? 'utf-8' : query.encoding,
        detectedEncoding: 'utf-8',
        decodingErrors,
        revision: JSON.stringify([conflict.base, conflict.ours, conflict.theirs]),
      };
    },

    readFileHistory: async (id, path, query) => {
      await settle(query);

      return historyOfPath(find(id).history, path);
    },

    readTree: async (id, _at, query) => {
      await settle(query);

      // Se recolectan todas las rutas que el repositorio ficticio conoce:
      // las del vocabulario y las que aparecen en el estado de trabajo.
      const repo = find(id);
      const known = new Set<string>();

      for (const entry of PATHS) known.add(entry.path);

      for (const file of repo.status.staged) known.add(file.path);
      for (const file of repo.status.unstaged) known.add(file.path);
      for (const file of repo.status.conflicted) known.add(file.path);

      // Carpetas extra fijas para dar profundidad al árbol.
      const extraDirs = [
        'src/',
        'src/app/',
        'src/design/',
        'src/ui/',
        'src/features/',
        'src/features/working/',
        'src/features/repositories/',
        'src/core/',
        'src/core/domain/',
        'src/core/ports/',
        'src/core/adapters/',
        'src/i18n/',
        'src-tauri/',
        'src-tauri/src/',
        'src-tauri/src/git/',
        'src-tauri/src/git/read/',
        'src-tauri/src/git/write/',
        'docs/',
        'brand/',
        'brand/icons/',
        'tests/',
      ];

      // Se extraen los directorios de cada ruta de archivo conocida.
      const dirs = new Set<string>(extraDirs);

      for (const path of known) {
        const parts = path.split('/');

        // Descarta el último segmento (el archivo).
        for (let i = 1; i < parts.length; i++) {
          dirs.add(parts.slice(0, i).join('/') + '/');
        }
      }

      const entries: TreeEntry[] = [];

      for (const dir of dirs) {
        entries.push({ path: dir.slice(0, -1), kind: 'directory' });
      }

      for (const filePath of known) {
        entries.push({ path: filePath, kind: 'file' });
      }

      entries.sort((a, b) => a.path.localeCompare(b.path));

      return entries;
    },

    stage: async (id, paths, query) => {
      await settle(query);
      failIfProgrammed('stage');

      const previous = find(id);
      let next = previous;

      for (const path of paths) next = applyStaging(next, path, 'all');

      return store(remember(previous, next, 'undo.stage', {})).status;
    },

    unstage: async (id, paths, query) => {
      await settle(query);
      failIfProgrammed('unstage');

      const previous = find(id);
      let next = previous;

      for (const path of paths) next = applyStaging(next, path, null);

      return store(remember(previous, next, 'undo.unstage', {})).status;
    },

    stageHunks: async (id, request, query) => {
      await settle(query);
      failIfProgrammed('stageHunks');

      return restage(
        id,
        request.path,
        grow(find(id), request.path, linesOfHunks(request.path, request.hunkIds ?? [])),
      );
    },

    unstageHunks: async (id, request, query) => {
      await settle(query);
      failIfProgrammed('unstageHunks');

      return restage(
        id,
        request.path,
        shrink(find(id), request.path, linesOfHunks(request.path, request.hunkIds ?? [])),
      );
    },

    stageLines: async (id, request, query) => {
      await settle(query);
      failIfProgrammed('stageLines');

      return restage(
        id,
        request.path,
        grow(find(id), request.path, known(find(id), request.path, request.lines ?? [])),
      );
    },

    unstageLines: async (id, request, query) => {
      await settle(query);
      failIfProgrammed('unstageLines');

      return restage(
        id,
        request.path,
        shrink(find(id), request.path, known(find(id), request.path, request.lines ?? [])),
      );
    },

    discardAll: async (id, _precondition, query) => {
      await settle(query);
      failIfProgrammed('discardAll');
      const repo = find(id);
      return store(
        remember(
          repo,
          { ...repo, status: { ...repo.status, staged: [], unstaged: [], conflicted: [] } },
          'undo.discard',
          {},
        ),
      ).status;
    },
    discard: async (id, targets, query) => {
      await settle(query);
      failIfProgrammed('discard');

      let repo = find(id);

      for (const target of targets) repo = discardPath(repo, target.path);

      return store(remember(find(id), repo, 'undo.discard', {})).status;
    },

    discardLines: async (id, request, query) => {
      await settle(query);
      failIfProgrammed('discardLines');

      return store(
        remember(
          find(id),
          applyDiscard(find(id), request.path, request.lines ?? []),
          'undo.discard',
          {},
        ),
      ).status;
    },

    resolveConflict: async (id, path, content, query) => {
      await settle(query);
      failIfProgrammed('resolveConflict');
      if (query?.expectedRevision !== undefined) {
        const current = find(id).conflicts.get(path);
        if (
          !current ||
          JSON.stringify([current.base, current.ours, current.theirs]) !== query.expectedRevision
        ) {
          throw new GitOperationError('write.stale', { path });
        }
      }
      return store(applyResolution(find(id), path, content)).status;
    },

    markConflictsResolved: async (id, paths, query) => {
      await settle(query);
      failIfProgrammed('markConflictsResolved');
      let repo = find(id);
      for (const path of paths) repo = applyResolution(repo, path, '');
      return store(repo).status;
    },

    markConflictResolved: async (id, path, query) => {
      await settle(query);
      failIfProgrammed('markConflictResolved');

      return store(applyResolution(find(id), path, '')).status;
    },

    unresolveConflict: async (id, path, query) => {
      await settle(query);
      failIfProgrammed('unresolveConflict');

      return store(undoResolution(find(id), path)).status;
    },

    keepSide: async (id, path, side, query) => {
      await settle(query);
      failIfProgrammed('keepSide');

      const repo = find(id);
      const conflict = repo.conflicts.get(path);

      /*
       * Quedarse con un lado no carga el texto: es el camino de los binarios y
       * de lo que pasa del tope, y ahí el contenido no llega a pasar por la
       * ventana. Cuando sí hay texto —porque el archivo era pequeño y se eligió
       * el atajo— se guarda, que es lo que el árbol de trabajo tendría.
       */
      return store(applyResolution(repo, path, conflict?.[side] ?? null)).status;
    },

    autoResolve: async (id, query) => {
      await settle(query);
      failIfProgrammed('autoResolve');

      let repo = find(id);
      const resolved: Resolution[] = [];

      for (const [path, conflict] of repo.conflicts) {
        const text = unambiguousResolution(conflict);

        if (text === null) continue;

        repo = applyResolution(repo, path, text);
        resolved.push({ path, origin: 'auto' });
      }

      return { resolved, status: store(repo).status };
    },

    ignorePath: async (id, pattern, options, query) => {
      await settle(query);
      failIfProgrammed('ignorePath');

      return store(ignoreIn(find(id), pattern, options?.untrack === true)).status;
    },

    commit: async (id, request, query) => {
      await settle(query);
      failIfProgrammed('commit');

      const repo = find(id);

      if (nothingToCommit(repo, request)) throw new GitOperationError('commit.nothingStaged', {});

      const sha = random.hex(40);

      store(
        remember(
          repo,
          commitIn(repo, request, sha, Date.now(), identities.get(id) ?? CONFIG_IDENTITY),
          request.amend === true ? 'undo.amend' : 'undo.commit',
          { branch: headName(repo), summary: request.summary },
        ),
      );

      return sha;
    },

    createBranch: async (id, name, from, options, query) => {
      await settle(query);
      failIfProgrammed('createBranch');

      const repo = find(id);
      const existing = localBranch(repo, name);

      if (existing) throw new GitOperationError('branch.exists', { branch: name });

      const branch: Branch = {
        id: `refs/heads/${name}`,
        name,
        kind: 'local',
        tip: resolveTarget(repo, from),
        ahead: 0,
        behind: 0,
        isHead: false,
      };

      const withBranch = withRefs(repo, {
        ...repo.refs,
        branches: [...repo.refs.branches, branch],
      });

      const created = remember(repo, withBranch, 'undo.createBranch', {
        branch: name,
        from: labelOf(from),
      });
      const next =
        options?.checkout === true
          ? remember(created, switchTo(created, name), 'undo.checkout', {
              from: headName(repo),
              to: name,
            })
          : created;

      return store(next).refs;
    },

    readReflog: async (id, query) => {
      await settle(query);
      const repo = find(id);

      return repo.history.commits.slice(0, 12).map((commit, index) => ({
        selector: `HEAD@{${String(index)}}`,
        sha: commit.sha,
        at: commit.committedAt,
        summary: index === 0 ? `commit: ${commit.summary}` : `checkout: ${commit.summary}`,
      }));
    },

    recoverReflogEntry: async (id, name, selector, expectedSha, query) => {
      await settle(query);
      const repo = find(id);
      const index = Number.parseInt(selector.match(/^HEAD@\{(\d+)\}$/)?.[1] ?? '-1', 10);
      const commit = repo.history.commits[index];

      if (commit?.sha !== expectedSha) throw new GitOperationError('ref.stale', { ref: selector });
      if (localBranch(repo, name)) throw new GitOperationError('branch.exists', { branch: name });

      return store(
        remember(
          repo,
          withRefs(repo, {
            ...repo.refs,
            branches: [
              ...repo.refs.branches,
              {
                id: `refs/heads/${name}`,
                name,
                kind: 'local',
                tip: expectedSha,
                ahead: 0,
                behind: 0,
                isHead: false,
              },
            ],
          }),
          'undo.recoverBranch',
          { branch: name, from: selector },
        ),
      ).refs;
    },

    renameBranch: async (id, from, to, options, query) => {
      await settle(query);
      failIfProgrammed('renameBranch');

      const repo = find(id);
      const branch = localBranch(repo, from);

      if (options?.expectedTip !== undefined && branch?.tip !== options.expectedTip) {
        throw new GitOperationError('ref.stale', { ref: from });
      }
      if (!branch) return repo.refs;
      if (localBranch(repo, to)) throw new GitOperationError('branch.exists', { branch: to });

      return store(remember(repo, renameIn(repo, branch, to), 'undo.renameBranch', { from, to }))
        .refs;
    },

    deleteBranch: async (id, name, options, query) => {
      await settle(query);
      failIfProgrammed('deleteBranch');

      const repo = find(id);
      const branch = localBranch(repo, name);

      if (options?.expectedTip !== undefined && branch?.tip !== options.expectedTip) {
        throw new GitOperationError('ref.stale', { ref: name });
      }

      // La rama activa no se borra, y quien lo explica es el diálogo que valida
      // antes: aquí no hay nada que escribir ni nada que contar.
      if (!branch || branch.isHead) return repo.refs;

      if (options?.force !== true) {
        const target = repo.refs.head.branch ?? shortSha(repo.refs.head.sha);
        const count = countAhead(repo.history.byShaLookup, branch.tip, repo.refs.head.sha);

        if (count > 0) {
          throw new GitOperationError('branch.notMerged', { branch: name, target, count });
        }
      }

      return store(
        remember(
          repo,
          withRefs(repo, {
            ...repo.refs,
            branches: repo.refs.branches.filter((candidate) => candidate !== branch),
          }),
          'undo.deleteBranch',
          { branch: name },
        ),
      ).refs;
    },

    setUpstream: async (id, branch, upstream, query) => {
      await settle(query);
      failIfProgrammed('setUpstream');

      const repo = find(id);
      const local = localBranch(repo, branch);

      if (!local) return repo.refs;

      return store(withRefs(repo, upstreamIn(repo, local, upstream))).refs;
    },

    createTag: async (id, name, at, options, query) => {
      await settle(query);
      failIfProgrammed('createTag');

      const repo = find(id);

      if (repo.refs.tags.some((tag) => tag.name === name)) {
        throw new GitOperationError('tag.exists', { tag: name });
      }

      const message = options?.message;
      const target = resolveTarget(repo, at);

      return store(
        remember(
          repo,
          withRefs(repo, {
            ...repo.refs,
            tags: [
              ...repo.refs.tags,
              {
                id: `refs/tags/${name}`,
                name,
                target,
                annotated: message !== undefined,
                ...(message === undefined
                  ? {}
                  : { message, tagger: CONFIG_IDENTITY, taggedAt: Date.now() }),
              },
            ],
          }),
          'undo.createTag',
          { tag: name },
        ),
      ).refs;
    },

    deleteTag: async (id, name, options, query) => {
      await settle(query);
      failIfProgrammed('deleteTag');

      const repo = find(id);
      const tag = repo.refs.tags.find((candidate) => candidate.name === name);

      if (options?.expectedTip !== undefined && tag?.target !== options.expectedTip) {
        throw new GitOperationError('ref.stale', { ref: name });
      }
      const tags = repo.refs.tags.filter((tag) => tag.name !== name);

      if (tags.length === repo.refs.tags.length) return repo.refs;

      return store(
        remember(repo, withRefs(repo, { ...repo.refs, tags }), 'undo.deleteTag', { tag: name }),
      ).refs;
    },

    checkout: async (id, target, options, query) => {
      await settle(query);
      failIfProgrammed('checkout');

      const repo = find(id);
      const dirty = repo.status.staged.length + repo.status.unstaged.length;

      if (target.kind === 'remoteBranch') {
        const remote = repo.refs.branches.find(
          (branch) => branch.kind === 'remote' && branch.name === target.name,
        );
        const prefix = `${target.remote}/`;
        const localName = target.name.startsWith(prefix) ? target.name.slice(prefix.length) : '';
        const local = localBranch(repo, localName);

        if (
          (options?.expectedRemoteTip !== undefined && remote?.tip !== options.expectedRemoteTip) ||
          (options?.expectedLocalTip !== undefined && local?.tip !== options.expectedLocalTip)
        ) {
          throw new GitOperationError('ref.stale', { ref: target.name });
        }
      }

      if (dirty > 0 && options?.autoStash !== true) {
        throw new GitOperationError('checkout.dirtyTree', {
          branch: labelOf(target),
          count: dirty,
        });
      }

      /*
       * El guardado automático usa la redacción de git —`WIP on main`— y no una
       * cadena de i18n: el mensaje de un stash es un dato del repositorio, como
       * el de un commit, y quedaría escrito en el idioma que estuviera puesto el
       * día que se guardó.
       */
      const stashed =
        dirty > 0
          ? stashIn(
              repo,
              `WIP on ${repo.refs.head.branch ?? 'HEAD'}`,
              {},
              random.hex(40),
              Date.now(),
            )
          : repo;
      const switched = checkoutIn(stashed, target, options?.remoteMode);
      const restored =
        stashed.refs.stashes.length > repo.refs.stashes.length
          ? applyStashIn(switched, 0, true)
          : switched;

      return store(
        remember(repo, restored, 'undo.checkout', {
          branch: labelOf(target),
          from: headName(repo),
        }),
      ).refs;
    },

    createStash: async (id, message, options, query) => {
      await settle(query);
      failIfProgrammed('createStash');

      const repo = find(id);
      const next = stashIn(repo, message, options ?? {}, random.hex(40), Date.now());

      if (next === repo) throw new GitOperationError('stash.nothingToStash', {});

      return store(remember(repo, next, 'undo.stash', { branch: headName(repo), message })).refs;
    },

    renameStash: async (id, index, message, _options, query) => {
      await settle(query);
      failIfProgrammed('renameStash');

      return store(
        remember(find(id), renameStashIn(find(id), index, message), 'undo.renameStash', {}),
      ).refs;
    },

    applyStash: async (id, index, options, query) => {
      await settle(query);
      failIfProgrammed('applyStash');

      const repo = find(id);

      return store(
        remember(repo, applyStashIn(repo, index, options?.drop === true), 'undo.applyStash', {
          branch: headName(repo),
          index,
        }),
      ).status;
    },

    dropStash: async (id, index, _options, query) => {
      await settle(query);
      failIfProgrammed('dropStash');

      return store(remember(find(id), dropStashIn(find(id), index), 'undo.dropStash', {})).refs;
    },

    previewIntegration: async (id, kind, source, target, query) => {
      await settle(query);

      return previewOf(find(id), kind, source, target);
    },

    merge: async (id, source, options, query) => {
      await settle(query);
      failIfProgrammed('merge');

      const repo = busyOrThrow(id);
      const branch = branchOrThrow(repo, source);
      const target = headName(repo);
      const precondition = options?.precondition;
      if (
        precondition !== undefined &&
        (precondition.sourceRef !== source ||
          precondition.targetRef !== target ||
          precondition.sourceOid !== branch.tip ||
          precondition.targetOid !== repo.refs.head.sha)
      ) {
        throw new GitOperationError('ref.stale', { ref: source });
      }
      const outcome = mergeIn(repo, branch, options ?? {}, random.hex(40), Date.now());

      if (outcome.conflicts.length > 0)
        stopAt({ ...outcome, repo: remember(repo, outcome.repo, 'undo.merge', {}) });

      return store(remember(repo, outcome.repo, 'undo.merge', { source, target })).repository;
    },

    rebase: async (id, onto, options, query) => {
      await settle(query);
      failIfProgrammed('rebase');

      const repo = busyOrThrow(id);
      const branch = branchOrThrow(repo, onto);
      const precondition = options?.precondition;
      if (
        precondition !== undefined &&
        (precondition.sourceRef !== onto ||
          precondition.targetRef !== headName(repo) ||
          precondition.sourceOid !== branch.tip ||
          precondition.targetOid !== repo.refs.head.sha)
      ) {
        throw new GitOperationError('ref.stale', { ref: onto });
      }
      const outcome = rebaseIn(repo, branch, () => random.hex(40), Date.now());

      if (outcome.conflicts.length > 0)
        stopAt({ ...outcome, repo: remember(repo, outcome.repo, 'undo.rebase', {}) });

      return store(
        remember(repo, outcome.repo, 'undo.rebase', { source: headName(repo), target: onto }),
      ).repository;
    },

    cherryPick: async (id, shas, options, query) => {
      await settle(query);
      failIfProgrammed('cherryPick');

      const repo = busyOrThrow(id);
      const precondition = options?.precondition;
      if (
        precondition !== undefined &&
        (precondition.targetRef !== headName(repo) || precondition.targetOid !== repo.refs.head.sha)
      ) {
        throw new GitOperationError('ref.stale', { ref: precondition.targetRef });
      }
      const commits = commitsOrThrow(repo, shas);
      validateMainline(commits, options?.mainline);
      const outcome = pickIn(repo, commits, 'cherryPick', () => random.hex(40), Date.now());

      if (outcome.conflicts.length > 0)
        stopAt({ ...outcome, repo: remember(repo, outcome.repo, 'undo.cherryPick', {}) });

      return store(
        remember(repo, outcome.repo, 'undo.cherryPick', {
          count: commits.length,
          target: headName(repo),
        }),
      ).repository;
    },

    revert: async (id, shas, options, query) => {
      await settle(query);
      failIfProgrammed('revert');

      const repo = busyOrThrow(id);
      const precondition = options?.precondition;
      if (
        precondition !== undefined &&
        (precondition.targetRef !== headName(repo) || precondition.targetOid !== repo.refs.head.sha)
      ) {
        throw new GitOperationError('ref.stale', { ref: precondition.targetRef });
      }
      const commits = commitsOrThrow(repo, shas);
      validateMainline(commits, options?.mainline);
      const outcome = pickIn(repo, commits, 'revert', () => random.hex(40), Date.now());

      if (outcome.conflicts.length > 0)
        stopAt({ ...outcome, repo: remember(repo, outcome.repo, 'undo.revert', {}) });

      return store(
        remember(repo, outcome.repo, 'undo.revert', {
          count: commits.length,
          target: headName(repo),
        }),
      ).repository;
    },

    reset: async (id, to, mode, options, query) => {
      await settle(query);
      failIfProgrammed('reset');

      const repo = busyOrThrow(id);
      if (
        options !== undefined &&
        (options.expectedBranch !== headName(repo) ||
          options.precondition.head !== repo.refs.head.sha)
      ) {
        throw new GitOperationError('ref.stale', { ref: options.expectedBranch });
      }
      const next = resetIn(repo, to, mode);

      return store(
        remember(repo, next, 'undo.reset', { sha: shortSha(to), mode, target: headName(repo) }),
      ).repository;
    },

    continueOperation: async (id, query) => {
      await settle(query);
      failIfProgrammed('continueOperation');

      const repo = find(id);
      const next = continueIn(repo, random.hex(40), Date.now());

      if (next === repo) return repo.repository;

      const operation = repo.repository.operation;
      const named = operation.kind !== 'none' && operation.kind !== 'bisect';
      const params: Readonly<Record<string, string | number>> = named
        ? { source: operation.source, target: operation.target }
        : {};

      // El punto conserva el estado resuelto que precedía a Continuar.
      return store(remember(repo, next, `undo.${named ? operation.kind : 'merge'}`, params))
        .repository;
    },

    abortOperation: async (id, query) => {
      await settle(query);
      failIfProgrammed('abortOperation');

      return store(remember(find(id), abortIn(find(id)), 'undo.abort', {})).repository;
    },

    quitOperation: async (id, query) => {
      await settle(query);
      failIfProgrammed('quitOperation');
      const repo = find(id);
      if (repo.status.conflicted.length > 0) {
        throw new GitOperationError('resolve.stillConflicted', {
          count: repo.status.conflicted.length,
        });
      }
      const { recoveryOperation: _recovery, ...status } = repo.status;
      return store(
        remember(
          repo,
          {
            ...repo,
            repository: { ...repo.repository, operation: { kind: 'none' } },
            status,
            conflicts: new Map(),
            beforeOperation: null,
          },
          'undo.quit',
          {},
        ),
      ).repository;
    },

    fetch: async (id, remote, options, query) => {
      await settle(query);
      failIfProgrammed('fetch');

      await transfer(
        ['counting', 'receiving', 'resolving'],
        objectsFor(incoming(find(id))),
        options?.onProgress,
        () => settle(query),
      );

      return store(
        remember(find(id), fetchIn(find(id), remote, options?.prune === true), 'undo.fetch', {}),
      ).refs;
    },

    pull: async (id, options, query) => {
      await settle(query);
      failIfProgrammed('pull');

      const repo = busyOrThrow(id);
      const branch = trackedHeadOrThrow(repo);
      const upstream = branchOrThrow(repo, branch.upstream ?? '');

      /*
       * La regla de qué es «publicado» vive aquí y no en la vista: con commits
       * propios que nadie tiene todavía, rebasar no le rompe la historia a nadie
       * y la deja recta; en cuanto están subidos, reescribirlos sí molesta, y
       * entonces toca fusionar. Quien pinta la barra de estado repite el dato.
       */
      const reason = branch.ahead > 0 ? 'unpublished' : 'published';
      const asked = options?.strategy ?? 'auto';
      const strategy = asked === 'auto' ? (reason === 'unpublished' ? 'rebase' : 'merge') : asked;
      const received = branch.behind;

      await transfer(
        ['counting', 'receiving', 'resolving', 'checkout'],
        objectsFor(received),
        options?.onProgress,
        () => settle(query),
      );

      if (received > 0) {
        const fresh = find(id);
        const at = Date.now();
        const outcome =
          strategy === 'rebase'
            ? rebaseIn(fresh, upstream, () => random.hex(40), at)
            : mergeIn(fresh, upstream, {}, random.hex(40), at);

        if (outcome.conflicts.length > 0) stopAt(outcome);

        store(remember(fresh, outcome.repo, 'undo.pull', {}));
      }

      return { strategy, reason, received };
    },

    push: async (id, branch, options, query) => {
      await settle(query);
      failIfProgrammed('push');

      const repo = find(id);
      const local = localBranch(repo, branch);

      if (!local) return repo.refs;

      const configuredRemote = local.upstream?.split('/')[0];
      const remote = options?.setUpstream === true ? options.remote : configuredRemote;

      if (remote === undefined || (local.upstream === undefined && options?.setUpstream !== true)) {
        throw new GitOperationError(
          'push.noUpstream',
          { branch },
          { output: `fatal: The current branch ${branch} has no upstream branch.` },
        );
      }

      const remoteBranch = repo.refs.branches.find(
        (candidate) => candidate.kind === 'remote' && candidate.name === `${remote}/${branch}`,
      );
      if (
        options?.expectedRemoteTip !== undefined &&
        remoteBranch?.tip !== options.expectedRemoteTip
      ) {
        throw new GitOperationError('ref.stale', { ref: `${remote}/${branch}` });
      }

      if (local.behind > 0 && options?.expectedRemoteTip === undefined) {
        throw new GitOperationError(
          'push.rejected',
          { branch, remote, count: local.behind },
          { output: '! [rejected]        (fetch first)\nerror: failed to push some refs' },
        );
      }

      await transfer(
        ['counting', 'compressing', 'sending'],
        objectsFor(local.ahead),
        options?.onProgress,
        () => settle(query),
      );

      const before = find(id);
      const next = pushIn(before, branch, remote);
      const entry: UndoEntry = {
        id: random.hex(8),
        labelKey: 'undo.pushShared',
        params: {},
        at: Date.now(),
        undoable: false,
      };
      return store({ ...next, undoStack: [{ entry, before }, ...before.undoStack], redoStack: [] })
        .refs;
    },

    addRemote: async (id, remote, query) => {
      await settle(query);
      failIfProgrammed('addRemote');
      const repo = find(id);
      validateRemoteInput(repo, remote, false);
      return store(
        remember(repo, withRemotes(repo, [...repo.refs.remotes, remote]), 'undo.remote', {}),
      ).refs;
    },

    updateRemote: async (id, currentName, remote, expected, query) => {
      await settle(query);
      failIfProgrammed('updateRemote');
      const repo = find(id);
      const current = repo.refs.remotes.find((candidate) => candidate.name === currentName);
      if (!current) throw new GitOperationError('remote.notFound', { remote: currentName });
      if (current.fetchUrl !== expected.fetchUrl || current.pushUrl !== expected.pushUrl) {
        throw new GitOperationError('remote.stale', { remote: currentName });
      }
      validateRemoteInput(repo, remote, remote.name === currentName);
      return store(remember(repo, renameRemoteIn(repo, currentName, remote), 'undo.remote', {}))
        .refs;
    },

    removeRemote: async (id, name, expected, query) => {
      await settle(query);
      failIfProgrammed('removeRemote');
      const repo = find(id);
      const current = repo.refs.remotes.find((candidate) => candidate.name === name);
      if (!current) throw new GitOperationError('remote.notFound', { remote: name });
      if (current.fetchUrl !== expected.fetchUrl || current.pushUrl !== expected.pushUrl) {
        throw new GitOperationError('remote.stale', { remote: name });
      }
      return store(remember(repo, removeRemoteIn(repo, name), 'undo.remote', {})).refs;
    },

    createWorktree: async (id, path, branch, query) => {
      await settle(query);
      failIfProgrammed('createWorktree');

      const repo = find(id);

      /*
       * Lo único que el mundo falso sabe de una carpeta es si ya vive algo suyo
       * dentro: un repositorio conocido o un worktree que ya está ahí. No pasa
       * por `isMockRepositoryDirectory`, que da por repositorio todo lo que no
       * esté en su tabla — con esa regla no habría forma de estrenar carpeta.
       */
      if (at(path) || repo.refs.worktrees.some((worktree) => worktree.path === path)) {
        throw new GitOperationError(
          'worktree.pathNotEmpty',
          { path },
          { output: `fatal: '${path}' already exists` },
        );
      }

      const taken =
        branch.kind === 'branch'
          ? repo.refs.worktrees.find((worktree) => worktree.branch === branch.name)
          : undefined;

      if (taken) {
        throw new GitOperationError('worktree.branchInUse', {
          branch: labelOf(branch),
          path: taken.path,
        });
      }

      const head = resolveTarget(repo, branch);
      const name = basename(path);
      const entry: Worktree = {
        path,
        name,
        branch: labelOf(branch),
        head,
        isMain: false,
        locked: false,
        missing: false,
      };

      const parent = store(
        withRefs(repo, {
          ...repo.refs,
          worktrees: [...repo.refs.worktrees, entry],
          branches: repo.refs.branches.map((candidate) =>
            candidate.kind === 'local' && candidate.name === entry.branch
              ? { ...candidate, checkedOutIn: path }
              : candidate,
          ),
        }),
      );

      // El identificador sale de la carpeta y el nombre del repositorio se
      // hereda: son el mismo proyecto en dos sitios, y la lista lo enseña así.
      const child = buildWorktreeRepo(parent, {
        id: uniqueId(load(), name),
        name: parent.repository.name,
        path,
        branch: entry.branch,
        head,
      });

      register(child);

      return summaryOf(child);
    },

    removeWorktree: async (id, path, options, query) => {
      await settle(query);
      failIfProgrammed('removeWorktree');

      const repo = find(id);
      const entry = repo.refs.worktrees.find((worktree) => worktree.path === path);

      // El principal es la carpeta del propio repositorio, y uno bloqueado lo
      // está para esto: sin fuerza, las dos devuelven el mismo estado.
      if (!entry || entry.isMain) return repo.refs;
      if (entry.locked && options?.force !== true) return repo.refs;

      forgetAt(path, id);

      return store(
        withRefs(repo, {
          ...repo.refs,
          worktrees: repo.refs.worktrees.filter((worktree) => worktree !== entry),
          branches: repo.refs.branches.map((candidate) =>
            candidate.checkedOutIn === path ? withoutCheckout(candidate) : candidate,
          ),
        }),
      ).refs;
    },

    lockWorktree: async (id, path, locked, query) => {
      await settle(query);
      failIfProgrammed('lockWorktree');

      const repo = find(id);
      const entry = repo.refs.worktrees.find((worktree) => worktree.path === path);

      if (!entry || entry.locked === locked) return repo.refs;

      return store(
        withRefs(repo, {
          ...repo.refs,
          worktrees: repo.refs.worktrees.map((worktree) =>
            worktree === entry ? { ...worktree, locked } : worktree,
          ),
        }),
      ).refs;
    },

    readUndoStack: async (id, query) => {
      await settle(query);

      const repo = find(id);

      return {
        undo: repo.undoStack.map((step) => step.entry),
        redo: repo.redoStack.map((step) => step.entry),
      };
    },

    undo: async (id, query) => {
      await settle(query);
      failIfProgrammed('undo');

      return store(undoIn(find(id))).repository;
    },

    redo: async (id, query) => {
      await settle(query);
      failIfProgrammed('redo');

      return store(redoIn(find(id))).repository;
    },
  };
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function join(path: string, name: string): string {
  return `${path.replace(/\/+$/, '')}/${name}`;
}

/**
 * Un identificador libre a partir del nombre de la carpeta.
 *
 * Legible a propósito: `tesis`, y `tesis-2` si ya había uno. Un identificador
 * opaco no cambiaría nada para la aplicación, pero volvería ilegible cualquier
 * prueba y cualquier registro que lo mencione.
 */
function uniqueId(registry: MockRegistry, name: string): RepoId {
  const base = name.trim() === '' ? 'repo' : name.trim();

  if (!registry.repos.has(base)) return base;

  let suffix = 2;

  while (registry.repos.has(`${base}-${String(suffix)}`)) suffix += 1;

  return `${base}-${String(suffix)}`;
}

/**
 * Las cuatro fases de un clon, con su espera entre cada aviso.
 *
 * Cancelar aborta dentro de una de esas esperas y rechaza con
 * `OperationCancelledError`, que no es del catálogo y no pinta panel: quien
 * cancela un clon sabe perfectamente lo que hizo.
 */
async function progress(
  request: CloneRequest,
  objects: number,
  pause: () => Promise<void>,
): Promise<void> {
  const report = (phase: CloneProgress['phase'], received: number, total: number | null) => {
    request.onProgress?.({ phase, received, total });
  };

  await pause();
  report('counting', 0, null);

  for (let done = 1; done <= 4; done += 1) {
    await pause();
    report('receiving', Math.round((objects * done) / 4), objects);
  }

  await pause();
  report('resolving', objects, objects);

  await pause();
  report('checkout', objects, objects);
}

function summaryOf(repo: MockRepo): RepoSummary {
  const { id, name, path, head, lastOpenedAt, worktreeOf } = repo.repository;

  return { id, name, path, head, lastOpenedAt, ...(worktreeOf ? { worktreeOf } : {}) };
}

function missingObject(repository: Repository, sha: Sha): GitOperationError {
  return new GitOperationError(
    'unknown',
    {},
    { output: `fatal: bad object ${sha} en ${repository.name}` },
  );
}

/**
 * Una página del recorrido.
 *
 * Con `start` se recorre solo lo que esa referencia alcanza, que es lo que hace
 * `git log <rama>`; sin él salen todas las referencias juntas, que es lo que la
 * tabla enseña por defecto y lo que obliga al grafo a dibujar varias calles.
 *
 * Con `since`, el `total` es el del periodo y no el absoluto: la página dice
 * cuántos commits hay de lo que se pidió, y quien quiera la cifra completa la
 * pide sin acotar.
 */
function pageOf(repo: MockRepo, request: CommitPageRequest = {}): CommitPage {
  const reachable = request.start
    ? reachableFrom(repo, resolveRef(repo, request.start))
    : (() => {
        const stashes = new Set(repo.refs.stashes.map((stash) => stash.sha));
        return repo.history.commits.filter((commit) => !stashes.has(commit.sha));
      })();

  const since = request.since;
  const foldSearch = (value: string) =>
    value
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
  const scanned =
    request.search?.scanLimit === undefined
      ? reachable
      : reachable.slice(
          request.search.scanSkip ?? 0,
          (request.search.scanSkip ?? 0) + request.search.scanLimit,
        );
  const authors = new Set<string>();
  const commits = scanned.filter((commit) => {
    if (since !== undefined && commit.committedAt < since) return false;
    if (!request.search) return true;
    const { field, text } = request.search;
    const value =
      field === 'messages'
        ? `${commit.summary}\n${commit.body}`
        : field === 'authors'
          ? `${commit.author.name} <${commit.author.email}>`
          : commit.sha;
    if (!foldSearch(value).includes(foldSearch(text))) return false;
    if (field === 'authors') {
      if (authors.has(value)) return false;
      authors.add(value);
    }
    return true;
  });

  const skip = Math.max(0, request.skip ?? 0);
  const limit = request.limit ?? commits.length;
  const slice = commits.slice(skip, skip + limit);

  if (request.search?.scanLimit !== undefined) {
    // Stop at the last returned commit when the result limit cuts the scan short.
    const consumed =
      slice.length >= limit
        ? scanned.findIndex((commit) => commit.sha === slice.at(-1)?.sha) + 1
        : scanned.length;
    const cursor = (request.search.scanSkip ?? 0) + consumed;
    return {
      commits: slice,
      total: commits.length,
      hasMore: cursor < reachable.length,
      searchCursor: cursor,
    };
  }
  return { commits: slice, total: commits.length, hasMore: skip + slice.length < commits.length };
}

function resolveRef(repo: MockRepo, ref: string): Sha {
  const qualified = ref.startsWith('refs/');
  const branch = repo.refs.branches.find(
    (candidate) => candidate.id === ref || (!qualified && candidate.name === ref),
  );

  if (branch) return branch.tip;

  const tag = repo.refs.tags.find(
    (candidate) => candidate.id === ref || (!qualified && candidate.name === ref),
  );

  if (tag) return tag.target;

  if (repo.history.byShaLookup.has(ref)) return ref;

  throw new GitOperationError(
    'unknown',
    {},
    { output: `fatal: ambiguous argument '${ref}': unknown revision` },
  );
}

function reachableFrom(repo: MockRepo, tip: Sha): readonly Commit[] {
  const seen = new Set<Sha>();
  const pending: Sha[] = [tip];

  while (pending.length > 0) {
    const sha = pending.pop();

    if (sha === undefined || seen.has(sha)) continue;

    seen.add(sha);
    pending.push(...(repo.history.byShaLookup.get(sha)?.parents ?? []));
  }

  return repo.history.commits.filter((commit) => seen.has(commit.sha));
}

function sourceKey(source: DiffSource): string {
  switch (source.kind) {
    /*
     * El árbol de trabajo y el índice comparten generador **a propósito**: un
     * archivo tiene un solo juego de cambios, y lo que distingue a los dos
     * orígenes es cuáles de ellos están preparados, no que sean cambios
     * distintos. Generarlos por separado —como se hacía— daba dos diffs sin
     * nada que ver entre sí, y preparar una línea del uno no podía notarse en
     * el otro. Es también el juego que `hunksOf` usa para saber qué líneas se
     * pueden preparar.
     */
    case 'worktree':
    case 'index':
      return 'worktree';
    case 'commit':
    case 'stash':
      return `commit:${source.sha}`;
    case 'range':
      return `range:${source.from}:${source.to}`;
    case 'workingRange':
      return `workingRange:${source.from}`;
  }
}

interface MockFileSnapshot {
  /** El falso conserva la identidad al reutilizar un cambio en otra revisión. */
  identity: FileChange;
  file: FileChange;
}

function applySnapshotChanges(
  tree: Map<string, MockFileSnapshot>,
  files: readonly FileChange[],
): void {
  for (const file of files) {
    if (file.change === 'unmodified') continue;
    if (file.change === 'deleted') {
      tree.delete(file.path);
      continue;
    }
    const previous = file.previousPath ? tree.get(file.previousPath) : undefined;
    if (file.change === 'renamed' && file.previousPath) tree.delete(file.previousPath);
    tree.set(file.path, {
      identity:
        previous && file.insertions === 0 && file.deletions === 0 ? previous.identity : file,
      file,
    });
  }
}

/**
 * El fixture no almacena blobs: reconstruye identidades opacas por el primer padre.
 * Así, comparar extremos no equivale a unir todo lo que tocó su historia.
 */
function revisionSnapshot(repo: MockRepo, sha: Sha | null): Map<string, MockFileSnapshot> {
  const tree = new Map<string, MockFileSnapshot>();
  const commits: Commit[] = [];
  let current = sha === null || sha === '' ? null : resolveRef(repo, sha);
  while (current !== null && current !== '') {
    const commit = repo.history.byShaLookup.get(current);
    if (!commit) throw missingObject(repo.repository, current);
    commits.push(commit);
    current = commit.parents[0] ?? null;
  }
  for (const commit of commits.reverse()) {
    applySnapshotChanges(tree, filesOf(repo.history, commit.sha));
  }
  return tree;
}

function snapshotDifference(
  before: ReadonlyMap<string, MockFileSnapshot>,
  after: ReadonlyMap<string, MockFileSnapshot>,
): readonly FileChange[] {
  const files: FileChange[] = [];
  const renamed = new Set<string>();
  for (const [path, next] of after) {
    const previous = before.get(path);
    if (previous?.identity === next.identity) continue;
    const previousPath =
      previous === undefined
        ? next.file.previousPath &&
          before.has(next.file.previousPath) &&
          !after.has(next.file.previousPath)
          ? next.file.previousPath
          : [...before].find(
              ([oldPath, old]) => old.file.previousPath === path && !after.has(oldPath),
            )?.[0]
        : undefined;
    if (previousPath) renamed.add(previousPath);
    const { previousPath: _previousPath, ...file } = next.file;
    files.push({
      ...file,
      change: previousPath ? 'renamed' : previous ? 'modified' : 'added',
      ...(previousPath ? { previousPath } : {}),
    });
  }
  for (const [path, previous] of before) {
    if (after.has(path) || renamed.has(path)) continue;
    const { previousPath: _previousPath, ...file } = previous.file;
    files.push({
      ...file,
      change: 'deleted',
      insertions: 0,
      deletions: file.insertions + file.deletions,
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function diffFilesOf(repo: MockRepo, source: DiffSource): readonly FileChange[] {
  switch (source.kind) {
    case 'index':
      return repo.status.staged;
    case 'worktree':
      return [
        ...new Map(
          [...repo.status.unstaged, ...repo.status.conflicted].map((file) => [file.path, file]),
        ).values(),
      ];
    case 'commit': {
      return filesOf(repo.history, resolveRef(repo, source.sha));
    }
    case 'stash':
      return filesOf(repo.history, resolveRef(repo, source.sha)).map((file) =>
        file.change === 'untracked' ? { ...file, change: 'added' } : file,
      );
    case 'range':
      return snapshotDifference(
        revisionSnapshot(repo, source.from),
        revisionSnapshot(repo, source.to),
      );
    case 'workingRange': {
      const after = revisionSnapshot(repo, repo.refs.head.sha);
      applySnapshotChanges(after, repo.status.staged);
      applySnapshotChanges(after, repo.status.unstaged);
      applySnapshotChanges(after, repo.status.conflicted);
      return snapshotDifference(revisionSnapshot(repo, source.from), after);
    }
  }
}

/**
 * El diff de un archivo.
 *
 * El binario no se inventa como texto: devuelve su ficha con los dos tamaños,
 * que es lo único honesto que se puede enseñar de un `.png`. El de texto sale
 * del mismo generador que el archivo completo, así que los números de línea del
 * diff y los del visor de archivo son los mismos.
 */
function diffOf(repo: MockRepo, request: DiffRequest): FileDiff {
  const { binary, mediaType } = describePath(request.path);
  const comparison = request.source.kind === 'range' || request.source.kind === 'workingRange';
  const saved = comparison || request.source.kind === 'stash';
  const entry = saved
    ? diffFilesOf(repo, request.source).find((file) => file.path === request.path)
    : undefined;
  const change = saved ? (entry?.change ?? 'unmodified') : changeOf(repo, request.path);
  const identity = createRandom(seedFrom(`diff:${request.path}:${sourceKey(request.source)}`));
  const regular = () => ({ oid: identity.hex(40), mode: '100644' as const });
  const precondition = {
    before: change === 'added' || change === 'untracked' ? null : regular(),
    after: change === 'deleted' ? null : regular(),
  };
  if (change === 'unmodified') precondition.after = precondition.before;

  if (binary) {
    const random = createRandom(seedFrom(`binario:${request.path}:${sourceKey(request.source)}`));
    const oldSize = change === 'added' ? null : random.int(2_000, 240_000);

    return {
      path: request.path,
      ...(entry?.previousPath ? { previousPath: entry.previousPath } : {}),
      change,
      source: request.source,
      precondition,
      content: {
        kind: 'binary',
        oldSize,
        newSize:
          change === 'unmodified'
            ? oldSize
            : change === 'deleted'
              ? null
              : random.int(2_000, 240_000),
        mediaType,
      },
    };
  }

  const base = baseLines(request.path);
  const { edits } = editedLines(request.path, sourceKey(request.source));
  const hunks = hunksFromEdits(base, edits, request.context ?? DEFAULT_CONTEXT);

  return {
    path: request.path,
    ...(entry?.previousPath ? { previousPath: entry.previousPath } : {}),
    change,
    source: request.source,
    precondition,
    content: {
      kind: 'text',
      hunks: change === 'unmodified' ? [] : visibleHunks(repo, request, hunks),
      truncated: false,
      encoding: 'utf-8',
    },
  };
}

/**
 * El diff enseña lo que de verdad tiene ese origen, no todo lo generado.
 *
 * Es lo que faltaba para que preparar una línea se notara en el visor abierto:
 * hasta ahora `readDiff` devolvía el diff entero viniera de donde viniera, así
 * que pasar algo al stage cambiaba la lista de archivos y dejaba el visor
 * diciendo lo mismo de antes.
 *
 * El reparto es el de git: **el índice enseña lo preparado** y **el árbol de
 * trabajo lo que queda sin preparar**, menos lo descartado. Una línea que no le
 * toca a este origen desaparece; no se convierte en contexto, porque el texto
 * de al lado sería distinto y sería mentir. Un hunk que se queda sin cambios se
 * va entero.
 */
function visibleHunks(
  repo: MockRepo,
  request: DiffRequest,
  hunks: readonly Hunk[],
): readonly Hunk[] {
  // Un commit o un rango son historia escrita: ahí no hay stage que descontar.
  if (request.source.kind !== 'worktree' && request.source.kind !== 'index') return hunks;

  const staged = repo.staging.get(request.path);
  const discarded = repo.discarded.get(request.path);
  const index = request.source.kind === 'index';

  if (index && staged === 'all') return hunks;
  if (index && staged === undefined) return [];
  if (
    !index &&
    staged === undefined &&
    (discarded === undefined || (discarded.new.size === 0 && discarded.old.size === 0))
  )
    return hunks;

  const isStaged = (side: LineSide, line: number) =>
    staged === 'all' || (staged !== undefined && staged[side].has(line));
  const isDiscarded = (side: LineSide, line: number) =>
    discarded !== undefined && discarded[side].has(line);
  const keep = (side: LineSide, line: number) =>
    index ? isStaged(side, line) : !isStaged(side, line) && !isDiscarded(side, line);

  return hunks.flatMap((hunk) => {
    const lines = hunk.lines.filter((line) => {
      if (line.kind === 'context') return true;
      if (line.kind === 'added' && line.newLine !== null) return keep('new', line.newLine);
      if (line.kind === 'removed' && line.oldLine !== null) return keep('old', line.oldLine);
      return true;
    });

    if (!lines.some((line) => line.kind !== 'context')) return [];

    return [{ ...hunk, lines }];
  });
}

function changeOf(repo: MockRepo, path: string) {
  const known = [...repo.status.staged, ...repo.status.unstaged, ...repo.status.conflicted].find(
    (entry) => entry.path === path,
  );

  return known?.change ?? 'modified';
}

/**
 * Con quién firma el falso cuando el commit no trae perfil.
 *
 * Es el equivalente al `user.name` de `git config`: el puerto no puede quedarse
 * sin autor, y `commit.identityMissing` se encarga con `failNext` cuando lo que
 * se quiere probar es justamente la falta.
 */
const CONFIG_IDENTITY: Person = { name: 'Alex', email: 'alex@ejemplo.org' };

const GITIGNORE = '.gitignore';

/** Los commits que tocaron el archivo, siguiéndolo por su nombre anterior. */
function historyOfPath(history: History, path: string): readonly Commit[] {
  return history.commits.filter((commit) =>
    (history.filesBySha.get(commit.sha) ?? []).some(
      (change) => change.path === path || change.previousPath === path,
    ),
  );
}

/*
 * Los hunks del archivo en el árbol de trabajo, los mismos que devolvió
 * `readDiff`: la clave de contenido es `worktree` en los dos sitios, así que el
 * identificador de hunk que el visor enseñó es el que se puede preparar.
 */
function hunksOf(path: string): readonly Hunk[] {
  if (describePath(path).binary) return [];

  const base = baseLines(path);
  const { edits } = editedLines(path, 'worktree');

  return hunksFromEdits(base, edits, DEFAULT_CONTEXT);
}

/**
 * Las líneas de un hunk, separadas por lado del diff.
 *
 * Las añadidas van por su `newLine`; las eliminadas por su `oldLine`. Un hunk
 * que solo quita líneas sigue teniendo contenido por el lado `old`.
 */
function linesOfHunk(hunk: Hunk): SidedLines {
  const added = new Set<number>();
  const removed = new Set<number>();

  for (const line of hunk.lines) {
    if (line.kind === 'added' && line.newLine !== null) added.add(line.newLine);
    if (line.kind === 'removed' && line.oldLine !== null) removed.add(line.oldLine);
  }

  // Un hunk sin líneas añadidas se identifica por su posición de inicio.
  if (added.size === 0 && removed.size === 0) added.add(hunk.newStart);

  return { new: added, old: removed };
}

function linesOfHunks(path: string, hunkIds: readonly string[]): SidedLines {
  const wanted = new Set(hunkIds);
  const newLines = new Set<number>();
  const oldLines = new Set<number>();

  for (const hunk of hunksOf(path)) {
    if (!wanted.has(hunk.id)) continue;

    const sides = linesOfHunk(hunk);

    for (const n of sides.new) newLines.add(n);
    for (const o of sides.old) oldLines.add(o);
  }

  return { new: newLines, old: oldLines };
}

function allLinesOf(path: string): SidedLines {
  const newLines = new Set<number>();
  const oldLines = new Set<number>();

  for (const hunk of hunksOf(path)) {
    const sides = linesOfHunk(hunk);

    for (const n of sides.new) newLines.add(n);
    for (const o of sides.old) oldLines.add(o);
  }

  return { new: newLines, old: oldLines };
}

/** Lo que sigue cambiado de verdad: lo generado, menos lo que ya se descartó. */
function activeLinesOf(repo: MockRepo, path: string): SidedLines {
  const discarded = repo.discarded.get(path);
  const all = allLinesOf(path);

  if (!discarded || (discarded.new.size === 0 && discarded.old.size === 0)) return all;

  return {
    new: new Set([...all.new].filter((line) => !discarded.new.has(line))),
    old: new Set([...all.old].filter((line) => !discarded.old.has(line))),
  };
}

/** Las que de verdad cambiaron: pedir una línea de contexto no prepara nada. */
function known(repo: MockRepo, path: string, lines: readonly LineRef[]): SidedLines {
  const changed = activeLinesOf(repo, path);
  const newLines = new Set<number>();
  const oldLines = new Set<number>();

  for (const ref of lines) {
    if (ref.side === 'new' && changed.new.has(ref.line)) newLines.add(ref.line);
    if (ref.side === 'old' && changed.old.has(ref.line)) oldLines.add(ref.line);
  }

  return { new: newLines, old: oldLines };
}

/** El total de líneas cambiadas entre ambos lados. */
function sidedSize(sided: SidedLines): number {
  return sided.new.size + sided.old.size;
}

/** Une dos SidedLines sumando sus conjuntos. */
function mergeSided(a: SidedLines, b: SidedLines): SidedLines {
  return {
    new: new Set([...a.new, ...b.new]),
    old: new Set([...a.old, ...b.old]),
  };
}

function grow(repo: MockRepo, path: string, lines: SidedLines): StagedPart | null {
  const current = repo.staging.get(path);

  if (current === 'all' || sidedSize(lines) === 0) return current ?? null;

  if (current === undefined) return lines;

  return mergeSided(current, lines);
}

function shrink(repo: MockRepo, path: string, lines: SidedLines): StagedPart | null {
  const current = repo.staging.get(path);

  if (current === undefined) return null;
  if (sidedSize(lines) === 0) return current;

  const base: SidedLines = current === 'all' ? activeLinesOf(repo, path) : current;
  const next: SidedLines = {
    new: new Set([...base.new].filter((line) => !lines.new.has(line))),
    old: new Set([...base.old].filter((line) => !lines.old.has(line))),
  };

  return sidedSize(next) === 0 ? null : next;
}

/**
 * El archivo entero, sumando las dos mitades.
 *
 * Un archivo a medio preparar aparece en las dos listas, y entre las dos suman
 * lo que cambió: por eso no hace falta guardar el original en ningún sitio.
 * Nace `added` en el stage y `untracked` fuera porque es el mismo archivo
 * nuevo, y quitarlo del stage lo devuelve a sin seguimiento.
 */
function wholeChange(status: WorkingStatus, path: string): FileChange | undefined {
  const staged = status.staged.find((change) => change.path === path);
  const unstaged = status.unstaged.find((change) => change.path === path);
  const base = unstaged ?? staged;

  if (!base) return undefined;

  return {
    ...base,
    change: base.change === 'added' ? 'untracked' : base.change,
    insertions: (staged?.insertions ?? 0) + (unstaged?.insertions ?? 0),
    deletions: (staged?.deletions ?? 0) + (unstaged?.deletions ?? 0),
  };
}

/** Lo que le toca a la mitad preparada, sin que las dos dejen de sumar el total. */
function share(total: number, fraction: number): number {
  if (total === 0 || fraction <= 0) return 0;
  if (fraction >= 1) return total;

  return Math.min(total, Math.max(1, Math.round(total * fraction)));
}

function statusOf(
  staged: readonly FileChange[],
  unstaged: readonly FileChange[],
  conflicted: readonly FileChange[],
): WorkingStatus {
  return {
    staged,
    unstaged,
    conflicted,
    clean: staged.length === 0 && unstaged.length === 0 && conflicted.length === 0,
  };
}

function replaceIn(
  list: readonly FileChange[],
  path: string,
  entry: FileChange | undefined,
): readonly FileChange[] {
  const known = list.some((change) => change.path === path);

  // El archivo se queda donde estaba en la lista: reordenarla al preparar movería
  // la fila bajo el puntero de quien acaba de pulsarla.
  if (entry === undefined) return known ? list.filter((change) => change.path !== path) : list;
  if (!known) return [...list, entry];

  return list.map((change) => (change.path === path ? entry : change));
}

function samePart(before: StagedPart | undefined, after: StagedPart | null): boolean {
  if (before === undefined || after === null) return before === undefined && after === null;
  if (before === 'all' || after === 'all') return before === after;

  return (
    before.new.size === after.new.size &&
    before.old.size === after.old.size &&
    [...before.new].every((line) => after.new.has(line)) &&
    [...before.old].every((line) => after.old.has(line))
  );
}

/**
 * Deja el archivo preparado del todo, a medias o nada, y reparte sus números.
 *
 * Preparar un archivo que no cambió no es un fallo, es nada: devuelve el mismo
 * repositorio sin escribir ni lanzar, como toda mutación imposible desde F0.9.
 */
function applyStaging(repo: MockRepo, path: string, part: StagedPart | null): MockRepo {
  const conflicted = repo.status.conflicted.find((change) => change.path === path);

  /*
   * Preparar un archivo en conflicto es lo que git entiende por «ya lo decidí»:
   * `git add` sobre un conflicto lo da por resuelto, y es el gesto con el que
   * Resolver cierra cada archivo antes de que `continueOperation` pueda cerrar
   * la operación entera. Quitarlo del stage no lo devuelve al conflicto, porque
   * la decisión ya se tomó.
   */
  if (conflicted) return part === null ? repo : resolveConflict(repo, conflicted);

  const whole = wholeChange(repo.status, path);

  if (!whole) return repo;
  if (samePart(repo.staging.get(path), part)) return repo;

  const total = sidedSize(activeLinesOf(repo, path));
  const fraction =
    part === null ? 0 : part === 'all' || total === 0 ? 1 : Math.min(1, sidedSize(part) / total);

  const staged =
    fraction <= 0
      ? undefined
      : {
          ...whole,
          change: whole.change === 'untracked' ? ('added' as const) : whole.change,
          insertions: share(whole.insertions, fraction),
          deletions: share(whole.deletions, fraction),
        };

  const unstaged =
    fraction >= 1
      ? undefined
      : {
          ...whole,
          insertions: whole.insertions - (staged?.insertions ?? 0),
          deletions: whole.deletions - (staged?.deletions ?? 0),
        };

  const staging = new Map(repo.staging);

  if (fraction >= 1) staging.set(path, 'all');
  else if (fraction <= 0) staging.delete(path);
  else if (part !== null && part !== 'all') staging.set(path, part);

  return {
    ...repo,
    status: statusOf(
      replaceIn(repo.status.staged, path, staged),
      replaceIn(repo.status.unstaged, path, unstaged),
      repo.status.conflicted,
    ),
    staging,
  };
}

function stagedLinesOf(repo: MockRepo, path: string): SidedLines {
  const part = repo.staging.get(path);

  if (part === undefined) return { new: new Set(), old: new Set() };

  return part === 'all' ? activeLinesOf(repo, path) : part;
}

/**
 * Descarta líneas del árbol de trabajo.
 *
 * No alcanza el índice: una línea ya preparada no se puede descartar por
 * aquí, porque descartar no se deshace y quitar del stage sí. La cuenta de
 * `insertions`/`deletions` se reparte con `share`, igual que `applyStaging` —
 * no hace falta que sea exacta línea por línea, solo que la lista de archivos
 * siga sumando algo razonable.
 */
function applyDiscard(repo: MockRepo, path: string, lines: readonly LineRef[]): MockRepo {
  const unstaged = repo.status.unstaged.find((change) => change.path === path);

  if (!unstaged) return repo;

  const staged = stagedLinesOf(repo, path);
  const resolved = known(repo, path, lines);
  // Solo se descarta lo que no está preparado.
  const discardable: SidedLines = {
    new: new Set([...resolved.new].filter((line) => !staged.new.has(line))),
    old: new Set([...resolved.old].filter((line) => !staged.old.has(line))),
  };

  if (sidedSize(discardable) === 0) return repo;

  const activeUnstaged = sidedSize(activeLinesOf(repo, path)) - sidedSize(staged);
  const fraction = activeUnstaged <= 0 ? 1 : sidedSize(discardable) / activeUnstaged;

  const insertions = unstaged.insertions - share(unstaged.insertions, fraction);
  const deletions = unstaged.deletions - share(unstaged.deletions, fraction);
  const next =
    insertions <= 0 && deletions <= 0 ? undefined : { ...unstaged, insertions, deletions };

  const existing = repo.discarded.get(path) ?? { new: new Set<number>(), old: new Set<number>() };
  const discarded = new Map(repo.discarded);

  discarded.set(path, {
    new: new Set([...existing.new, ...discardable.new]),
    old: new Set([...existing.old, ...discardable.old]),
  });

  return {
    ...repo,
    status: statusOf(
      repo.status.staged,
      replaceIn(repo.status.unstaged, path, next),
      repo.status.conflicted,
    ),
    discarded,
  };
}

/** El archivo resuelto pasa al stage y deja de tener tres versiones que enseñar. */
function resolveConflict(repo: MockRepo, conflicted: FileChange): MockRepo {
  const conflicts = new Map(repo.conflicts);

  conflicts.delete(conflicted.path);

  const resolved: FileChange = {
    path: conflicted.path,
    change: 'modified',
    binary: conflicted.binary,
    insertions: conflicted.insertions,
    deletions: conflicted.deletions,
  };

  return {
    ...repo,
    status: statusOf(
      [...repo.status.staged, resolved],
      repo.status.unstaged,
      repo.status.conflicted.filter((change) => change !== conflicted),
    ),
    conflicts,
    staging: new Map(repo.staging).set(conflicted.path, 'all'),
  };
}

/**
 * Resuelve un conflicto con el texto que le den, o sin texto.
 *
 * Sin texto es lo normal en un binario y en lo que pasa del tope: el archivo
 * queda resuelto igual, y lo que no hay es un contenido que enseñar después.
 * Un archivo que ya no está en conflicto **no es un fallo**: es alguien que lo
 * resolvió por fuera, y el estado se devuelve tal cual, como hace el resto de
 * la escritura con lo imposible.
 */
function applyResolution(repo: MockRepo, path: string, content: string | null): MockRepo {
  const conflicted = repo.status.conflicted.find((change) => change.path === path);

  if (!conflicted) return repo;

  const next = resolveConflict(repo, conflicted);
  const resolved = new Map(next.resolved);

  if (content === null) resolved.delete(path);
  else resolved.set(path, content);

  return { ...next, resolved };
}

/**
 * Devuelve un archivo resuelto a conflicto, con sus tres versiones otra vez.
 *
 * El conflicto se vuelve a generar en vez de guardarse: el mundo falso es
 * determinista, así que `conflictFor` devuelve exactamente lo mismo que la
 * primera vez y guardarlo sería una copia que mantener de acuerdo.
 */
function undoResolution(repo: MockRepo, path: string): MockRepo {
  const staged = repo.status.staged.find((change) => change.path === path);

  if (!staged || !repo.resolved.has(path)) return repo;

  /*
   * Los dos rótulos salen de la operación a medias, que es de donde salieron la
   * primera vez. `bisect` y `none` no tienen dos ramas que nombrar —no son
   * integraciones— y ahí el conflicto no puede existir, pero el tipo obliga a
   * contestar algo: HEAD contra HEAD, que es lo que un `git status` diría.
   */
  const operation = repo.repository.operation;
  const named = operation.kind !== 'none' && operation.kind !== 'bisect';
  const conflicted: FileChange = { ...staged, change: 'conflicted', conflict: 'bothModified' };
  const conflicts = new Map(repo.conflicts).set(
    path,
    conflictFor(conflicted, named ? operation.target : 'HEAD', named ? operation.source : 'HEAD'),
  );
  const staging = new Map(repo.staging);
  const resolved = new Map(repo.resolved);

  staging.delete(path);
  resolved.delete(path);

  return {
    ...repo,
    status: statusOf(
      repo.status.staged.filter((change) => change !== staged),
      repo.status.unstaged,
      [...repo.status.conflicted, conflicted],
    ),
    conflicts,
    staging,
    resolved,
  };
}

/**
 * Lo que se puede resolver sin arriesgarse a acertar mal.
 *
 * Dos casos, y no hay un tercero: los dos lados escribieron exactamente lo
 * mismo, o uno de los dos no tocó nada respecto de la base. Todo lo demás pide
 * una decisión, y el plan lleva decidido desde el principio que la máquina no
 * la toma. Devuelve el texto con el que resolver, o `null` si no toca.
 */
function unambiguousResolution(conflict: ConflictContents): string | null {
  if (conflict.tooLarge) return null;

  const { base, ours, theirs } = conflict;

  if (ours !== null && ours === theirs) return ours;
  if (base !== null && ours === base && theirs !== null) return theirs;
  if (base !== null && theirs === base && ours !== null) return ours;

  return null;
}

/** Descartar deja el archivo como en HEAD, así que se va de las dos listas. */
function discardPath(repo: MockRepo, path: string): MockRepo {
  if (!wholeChange(repo.status, path)) return repo;

  const staging = new Map(repo.staging);

  staging.delete(path);

  return {
    ...repo,
    status: statusOf(
      replaceIn(repo.status.staged, path, undefined),
      replaceIn(repo.status.unstaged, path, undefined),
      repo.status.conflicted,
    ),
    staging,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Si un patrón de `.gitignore` tapa una ruta.
 *
 * Cubre las tres formas que se escriben a mano desde el menú contextual: la
 * ruta entera, un nombre suelto que vale en cualquier carpeta y un comodín de
 * extensión. Lo demás —negaciones, `**`, anclas— es sintaxis que la vista no
 * ofrece escribir.
 */
function matchesIgnore(path: string, pattern: string): boolean {
  const clean = pattern.replace(/^\/+|\/+$/g, '');

  if (clean === '') return false;

  const regex = new RegExp(`^${clean.split('*').map(escapeRegExp).join('[^/]*')}$`);

  return (
    regex.test(path) ||
    path.split('/').some((segment) => regex.test(segment)) ||
    path.startsWith(`${clean}/`)
  );
}

/**
 * Suma el patrón a `.gitignore` y saca de la vista lo que tapa.
 *
 * Un patrón repetido o vacío devuelve el mismo estado sin escribir ni lanzar:
 * no hay código de error para esto porque no hay nada que explicar que el campo
 * de patrón no valide antes. Con `untrack`, lo que ya tenía seguimiento no
 * desaparece sino que queda como borrado en el stage, que es lo que hace
 * `git rm --cached`.
 */
function ignoreIn(repo: MockRepo, pattern: string, untrack: boolean): MockRepo {
  const clean = pattern.trim();

  if (clean === '' || repo.ignored.includes(clean)) return repo;

  const hidden = (change: FileChange) => matchesIgnore(change.path, clean);
  const untracked = (change: FileChange) => change.change === 'untracked';

  let staged = repo.status.staged;
  let unstaged = repo.status.unstaged.filter((change) => !(untracked(change) && hidden(change)));

  if (untrack) {
    const tracked = [...staged, ...unstaged].filter(hidden);
    const paths = new Set(tracked.map((change) => change.path));

    staged = [
      ...staged.filter((change) => !paths.has(change.path)),
      ...[...paths].map((path) => ({
        path,
        change: 'deleted' as const,
        binary: describePath(path).binary,
        insertions: 0,
        // El índice pierde el archivo entero, no las líneas que se editaron.
        deletions: describePath(path).binary ? 0 : baseLines(path).length,
      })),
    ];
    unstaged = unstaged.filter((change) => !paths.has(change.path));
  }

  // Escribir el patrón cambia un archivo del árbol, y el árbol tiene que
  // decirlo: si no, el commit siguiente se haría sin `.gitignore` dentro.
  if (![...staged, ...unstaged].some((change) => change.path === GITIGNORE)) {
    unstaged = [
      ...unstaged,
      { path: GITIGNORE, change: 'modified', binary: false, insertions: 1, deletions: 0 },
    ];
  }

  const staging = new Map(repo.staging);

  for (const [path] of repo.staging) {
    if (!staged.some((change) => change.path === path)) staging.delete(path);
  }

  return {
    ...repo,
    ignored: [...repo.ignored, clean],
    status: statusOf(staged, unstaged, repo.status.conflicted),
    staging,
  };
}

/** Un commit vacío no existe; rehacer el último sí, aunque no haya nada nuevo. */
function nothingToCommit(repo: MockRepo, request: CommitRequest): boolean {
  const amending = request.amend === true && repo.history.byShaLookup.has(repo.refs.head.sha);

  return repo.status.staged.length === 0 && !amending;
}

function withCommitted(
  history: History,
  commit: Commit,
  files: readonly FileChange[],
  replaced?: Sha,
): History {
  const commits = [commit, ...history.commits.filter((candidate) => candidate.sha !== replaced)];
  const filesBySha = new Map(history.filesBySha);

  if (replaced !== undefined) filesBySha.delete(replaced);
  filesBySha.set(commit.sha, files);

  return {
    ...history,
    commits,
    byShaLookup: new Map(commits.map((candidate) => [candidate.sha, candidate])),
    filesBySha,
  };
}

/** Mueve HEAD y, si no está desacoplado, la rama que lo lleva. */
function moveHead(refs: RefsSnapshot, sha: Sha): RefsSnapshot {
  const branch = refs.head.branch;

  return {
    ...refs,
    head: { ...refs.head, sha },
    branches: refs.branches.map((candidate) =>
      candidate.kind === 'local' && candidate.name === branch
        ? {
            ...candidate,
            tip: sha,
            ahead:
              candidate.upstream === undefined || candidate.upstreamMissing === true
                ? 0
                : candidate.ahead + 1,
          }
        : candidate,
    ),
    worktrees: refs.worktrees.map((worktree) =>
      worktree.branch === branch && worktree.isMain ? { ...worktree, head: sha } : worktree,
    ),
  };
}

/**
 * El commit, con lo que estaba preparado dentro.
 *
 * `amend` no encadena otro commit: reemplaza el de HEAD conservando su autor y
 * su fecha de autoría, que es lo que distingue a quien escribió el código de
 * quien lo rehizo.
 */
function commitIn(
  repo: MockRepo,
  request: CommitRequest,
  sha: Sha,
  at: number,
  identity: Person = CONFIG_IDENTITY,
): MockRepo {
  const head = repo.refs.head.sha;
  const merge = repo.repository.operation.kind === 'merge' ? repo.repository.operation : null;
  const mergeSource = merge ? branchNamed(repo, merge.source)?.tip : undefined;
  const previous = request.amend === true ? repo.history.byShaLookup.get(head) : undefined;
  const author = request.author ?? previous?.author ?? identity;

  const commit: Commit = {
    sha,
    parents: previous
      ? previous.parents
      : mergeSource
        ? [head, mergeSource]
        : head === ''
          ? []
          : [head],
    summary: request.summary,
    body: request.body,
    author,
    authoredAt: previous?.authoredAt ?? at,
    committer: request.author ?? identity,
    committedAt: at,
  };

  const messageOnly = previous !== undefined && request.amendMessageOnly === true;
  const files =
    !messageOnly && repo.status.staged.length > 0
      ? repo.status.staged
      : previous
        ? filesOf(repo.history, previous.sha)
        : [];

  const history = withCommitted(repo.history, commit, files, previous?.sha);
  const branch = repo.refs.head.branch;
  const staging = new Map(repo.staging);

  if (!messageOnly) {
    for (const change of repo.status.staged) staging.delete(change.path);
  }

  return {
    ...repo,
    history:
      branch === null ? history : { ...history, tips: new Map(history.tips).set(branch, sha) },
    refs: moveHead(repo.refs, sha),
    ...(merge
      ? {
          repository: { ...repo.repository, operation: { kind: 'none' as const } },
          beforeOperation: null,
          conflicts: new Map(),
        }
      : {}),
    status: statusOf(
      messageOnly ? repo.status.staged : [],
      repo.status.unstaged,
      repo.status.conflicted,
    ),
    staging,
  };
}

function localBranch(repo: MockRepo, name: string): Branch | undefined {
  return repo.refs.branches.find((branch) => branch.kind === 'local' && branch.name === name);
}

function labelOf(target: RefTarget): string {
  return target.kind === 'commit' ? shortSha(target.sha) : target.name;
}

function resolveTarget(repo: MockRepo, target: RefTarget): Sha {
  const found =
    target.kind === 'branch'
      ? repo.refs.branches.find((branch) => branch.kind === 'local' && branch.name === target.name)
          ?.tip
      : target.kind === 'remoteBranch'
        ? repo.refs.branches.find(
            (branch) => branch.kind === 'remote' && branch.name === target.name,
          )?.tip
        : target.kind === 'tag'
          ? repo.refs.tags.find((tag) => tag.name === target.name)?.target
          : repo.history.byShaLookup.get(target.sha)?.sha;

  if (found === undefined) {
    throw new GitOperationError(
      'unknown',
      {},
      { output: `fatal: ambiguous argument '${labelOf(target)}': unknown revision` },
    );
  }

  return found;
}

function withRefs(repo: MockRepo, refs: RefsSnapshot): MockRepo {
  return { ...repo, refs };
}

function switchTo(repo: MockRepo, name: string): MockRepo {
  const branch = localBranch(repo, name);

  if (!branch) return repo;

  return {
    ...repo,
    refs: {
      ...repo.refs,
      head: { branch: name, sha: branch.tip, detached: false },
      branches: repo.refs.branches.map((candidate) =>
        candidate.kind === 'local' ? { ...candidate, isHead: candidate.name === name } : candidate,
      ),
    },
    repository: { ...repo.repository, head: name },
  };
}

/** Un tag o un commit se revisan con HEAD desacoplado: no hay rama que mover. */
function checkoutIn(
  repo: MockRepo,
  target: RefTarget,
  remoteMode: 'switch' | 'fastForward' | 'reset' = 'switch',
): MockRepo {
  if (target.kind === 'branch' && localBranch(repo, target.name)) {
    return switchTo(repo, target.name);
  }

  if (target.kind === 'remoteBranch') {
    const remote = repo.refs.branches.find(
      (branch) => branch.kind === 'remote' && branch.name === target.name,
    );
    if (!remote) resolveTarget(repo, target);

    const prefix = `${target.remote}/`;
    const localName = target.name.startsWith(prefix) ? target.name.slice(prefix.length) : '';
    if (localName === '') return repo;
    const local = localBranch(repo, localName);
    if (local) {
      if (remoteMode === 'fastForward' && local.ahead > 0) {
        throw new GitOperationError(
          'unknown',
          {},
          { output: 'fatal: Not possible to fast-forward' },
        );
      }
      if (remoteMode === 'switch') return switchTo(repo, localName);

      const aligned = withRefs(repo, {
        ...repo.refs,
        branches: repo.refs.branches.map((branch) =>
          branch.kind === 'local' && branch.name === localName
            ? withoutMissingUpstream({
                ...branch,
                tip: remote!.tip,
                upstream: remote!.name,
                ahead: 0,
                behind: 0,
              })
            : branch,
        ),
      });
      return switchTo(aligned, localName);
    }

    const withLocal = withRefs(repo, {
      ...repo.refs,
      branches: [
        ...repo.refs.branches,
        {
          id: `refs/heads/${localName}`,
          name: localName,
          kind: 'local',
          tip: remote!.tip,
          upstream: remote!.name,
          ahead: 0,
          behind: 0,
          isHead: false,
        },
      ],
    });
    return switchTo(withLocal, localName);
  }

  const sha = resolveTarget(repo, target);

  return {
    ...repo,
    refs: {
      ...repo.refs,
      head: { branch: null, sha, detached: true },
      branches: repo.refs.branches.map((candidate) =>
        candidate.isHead ? { ...candidate, isHead: false } : candidate,
      ),
    },
    repository: { ...repo.repository, head: shortSha(sha) },
  };
}

function renameIn(repo: MockRepo, branch: Branch, to: string): MockRepo {
  const refs: RefsSnapshot = {
    ...repo.refs,
    branches: repo.refs.branches.map((candidate) =>
      candidate === branch ? { ...candidate, id: `refs/heads/${to}`, name: to } : candidate,
    ),
    head:
      repo.refs.head.branch === branch.name ? { ...repo.refs.head, branch: to } : repo.refs.head,
    worktrees: repo.refs.worktrees.map((worktree) =>
      worktree.branch === branch.name ? { ...worktree, branch: to } : worktree,
    ),
    stashes: repo.refs.stashes.map((stash) =>
      stash.branch === branch.name ? { ...stash, branch: to } : stash,
    ),
  };

  return {
    ...repo,
    refs,
    repository:
      repo.repository.head === branch.name ? { ...repo.repository, head: to } : repo.repository,
  };
}

/** Publicar una rama o dejar de seguir: lo de más y lo de menos se recuenta. */
function upstreamIn(repo: MockRepo, local: Branch, upstream: string | null): RefsSnapshot {
  const remote =
    upstream === null
      ? undefined
      : repo.refs.branches.find((branch) => branch.kind === 'remote' && branch.name === upstream);

  const next: Branch = { ...local, ahead: 0, behind: 0 };
  delete next.upstreamMissing;

  if (upstream === null) delete next.upstream;
  else {
    next.upstream = upstream;

    if (remote) {
      next.ahead = countAhead(repo.history.byShaLookup, local.tip, remote.tip);
      next.behind = countAhead(repo.history.byShaLookup, remote.tip, local.tip);
    } else next.upstreamMissing = true;
  }

  return {
    ...repo.refs,
    branches: repo.refs.branches.map((candidate) => (candidate === local ? next : candidate)),
  };
}

/**
 * El guardado, con su commit detrás.
 *
 * No es una lista aparte: el grafo de F2.3 dibuja los stashes como nodos, así
 * que el falso los cuelga de HEAD como cuelga cualquier otro commit. Sin nada
 * que guardar devuelve el mismo repositorio, y es quien llama el que decide si
 * eso es un fallo —`createStash`— o no —el auto-stash de `checkout`—.
 */
function stashIn(
  repo: MockRepo,
  message: string,
  options: {
    includeUntracked?: boolean;
    keepStaged?: boolean;
    paths?: readonly string[];
  },
  sha: Sha,
  at: number,
): MockRepo {
  const keepStaged = options.keepStaged === true;
  const selected = options.paths === undefined ? null : new Set(options.paths);
  const accepts = (change: FileChange) => selected === null || selected.has(change.path);
  const taken = [
    ...(keepStaged ? [] : repo.status.staged.filter(accepts)),
    ...repo.status.unstaged.filter(
      (change) =>
        accepts(change) && (options.includeUntracked === true || change.change !== 'untracked'),
    ),
  ];

  if (taken.length === 0) return repo;

  const branch = repo.refs.head.branch ?? shortSha(repo.refs.head.sha);
  const commit: Commit = {
    sha,
    parents: repo.refs.head.sha === '' ? [] : [repo.refs.head.sha],
    summary: message,
    body: '',
    author: CONFIG_IDENTITY,
    authoredAt: at,
    committer: CONFIG_IDENTITY,
    committedAt: at,
  };

  const staged = keepStaged ? repo.status.staged : [];
  const gone = new Set(taken.map((change) => change.path));
  const staging = new Map<string, StagedPart>();

  for (const [path, part] of repo.staging) {
    if (staged.some((change) => change.path === path)) staging.set(path, 'all');
    else if (!gone.has(path)) staging.set(path, part);
  }

  return {
    ...repo,
    history: withCommitted(repo.history, commit, taken),
    refs: {
      ...repo.refs,
      stashes: [
        {
          index: 0,
          sha,
          base: repo.refs.head.sha,
          message,
          branch,
          createdAt: at,
          fileCount: gone.size,
        },
        ...repo.refs.stashes.map((stash) => ({ ...stash, index: stash.index + 1 })),
      ],
    },
    status: statusOf(
      staged,
      repo.status.unstaged.filter((change) => !gone.has(change.path)),
      repo.status.conflicted,
    ),
    staging,
  };
}

function renameStashIn(repo: MockRepo, index: number, message: string): MockRepo {
  const trimmed = message.trim();
  const target = repo.refs.stashes.find((stash) => stash.index === index);

  if (!target || trimmed === '' || target.message === trimmed) return repo;

  return withRefs(repo, {
    ...repo.refs,
    stashes: repo.refs.stashes.map((stash) =>
      stash.index === index ? { ...stash, message: trimmed } : stash,
    ),
  });
}

/** Lo guardado vuelve sin preparar: aplicar no es recordar qué estaba en el stage. */
function applyStashIn(repo: MockRepo, index: number, drop: boolean): MockRepo {
  const stash = repo.refs.stashes.find((candidate) => candidate.index === index);

  if (!stash) return repo;

  const present = new Set(repo.status.unstaged.map((change) => change.path));
  const restored = filesOf(repo.history, stash.sha).filter((change) => !present.has(change.path));

  const next: MockRepo = {
    ...repo,
    status: statusOf(
      repo.status.staged,
      [...repo.status.unstaged, ...restored],
      repo.status.conflicted,
    ),
  };

  return drop ? dropStashIn(next, index) : next;
}

function dropStashIn(repo: MockRepo, index: number): MockRepo {
  const stashes = repo.refs.stashes.filter((stash) => stash.index !== index);

  if (stashes.length === repo.refs.stashes.length) return repo;

  return withRefs(repo, {
    ...repo.refs,
    // `stash@{0}` es siempre el más reciente: quitar uno renumera los de debajo.
    stashes: stashes.map((stash, position) => ({ ...stash, index: position })),
  });
}

/**
 * El resultado de traer una rama hacia otra.
 *
 * Va con la lista de conflictos aparte y no como excepción porque el
 * repositorio a medias **también** hay que guardarlo: git deja el árbol en
 * conflicto y encima falla, y el falso tiene que hacer las dos cosas o la vista
 * Resolver no encontraría nada que resolver.
 */
interface Integration {
  repo: MockRepo;
  conflicts: readonly string[];
}

/** Cómo se nombra la rama activa en una frase. Con HEAD suelto, su SHA corto. */
function headName(repo: MockRepo): string {
  return repo.refs.head.branch ?? shortSha(repo.refs.head.sha);
}

function branchNamed(repo: MockRepo, name: string): Branch | undefined {
  return repo.refs.branches.find((branch) => branch.name === name);
}

function branchOrThrow(repo: MockRepo, name: string): Branch {
  const branch = branchNamed(repo, name);

  if (!branch) {
    throw new GitOperationError(
      'unknown',
      {},
      { output: `fatal: '${name}' does not point to a commit` },
    );
  }

  return branch;
}

function commitsOrThrow(repo: MockRepo, shas: readonly Sha[]): readonly Commit[] {
  return shas.map((sha) => {
    const commit = repo.history.byShaLookup.get(sha);

    if (!commit) throw missingObject(repo.repository, sha);

    return commit;
  });
}

function validateMainline(commits: readonly Commit[], mainline: number | undefined): void {
  for (const commit of commits) {
    if (commit.parents.length > 1) {
      if (mainline === undefined || commits.length !== 1) {
        throw new GitOperationError('history.mainlineRequired', { sha: shortSha(commit.sha) });
      }
      if (mainline < 1 || mainline > commit.parents.length) {
        throw new GitOperationError('history.mainlineInvalid', {
          sha: shortSha(commit.sha),
          parent: mainline,
          count: commit.parents.length,
        });
      }
    } else if (mainline !== undefined) {
      throw new GitOperationError('history.mainlineInvalid', {
        sha: shortSha(commit.sha),
        parent: mainline,
        count: commit.parents.length,
      });
    }
  }
}

/** Los que alcanza `from` y no alcanza `to`, del más nuevo al más viejo. */
function commitsBetween(repo: MockRepo, from: Sha, to: Sha): readonly Commit[] {
  const excluded = new Set(reachableFrom(repo, to).map((commit) => commit.sha));

  return reachableFrom(repo, from).filter((commit) => !excluded.has(commit.sha));
}

function filesTouched(repo: MockRepo, commits: readonly Commit[]): readonly FileChange[] {
  return commits.flatMap((commit) => [...filesOf(repo.history, commit.sha)]);
}

/** Lo que un lado le hizo a cada archivo en total: manda el cambio más reciente. */
function sideOf(files: readonly FileChange[]): ReadonlyMap<string, FileChange> {
  const net = new Map<string, FileChange>();

  for (const change of files) if (!net.has(change.path)) net.set(change.path, change);

  return net;
}

/**
 * Qué clase de choque hay en un archivo que los dos lados tocaron — o ninguno.
 *
 * **Que los dos toquen el mismo archivo no es un conflicto**, y suponer que sí
 * dejaría el falso sin una sola fusión limpia que enseñar. Lo que git no
 * combina por su cuenta es esto: que un lado borre lo que el otro editó, que
 * los dos lo estrenen, o que no sea texto y no haya líneas que mezclar. Dos
 * ediciones de un archivo de texto se resuelven solas casi siempre, y aquí se
 * dan por resueltas.
 */
function clashKind(ours: FileChange, theirs: FileChange): ConflictKind | null {
  if (ours.change === 'deleted' && theirs.change !== 'deleted') return 'deletedByUs';
  if (theirs.change === 'deleted' && ours.change !== 'deleted') return 'deletedByThem';

  if (ours.change === 'deleted') return null;

  const added = (change: FileChange) => change.change === 'added' || change.change === 'untracked';

  if (added(ours) && added(theirs)) return 'bothAdded';

  return ours.binary || theirs.binary ? 'bothModified' : null;
}

interface Clash {
  path: string;
  kind: ConflictKind;
}

function clashes(ours: readonly FileChange[], theirs: readonly FileChange[]): readonly Clash[] {
  const mine = sideOf(ours);
  const found: Clash[] = [];

  for (const [path, change] of sideOf(theirs)) {
    const ourChange = mine.get(path);
    const kind = ourChange === undefined ? null : clashKind(ourChange, change);

    if (kind !== null) found.push({ path, kind });
  }

  return found.sort((one, other) => one.path.localeCompare(other.path));
}

/**
 * Qué archivos chocarían, hasta donde se puede saber sin intentarlo.
 *
 * Con un renombrado de por medio la predicción por nombre deja de valer —el
 * mismo contenido vive bajo dos nombres—, y entonces la respuesta honesta es
 * `null`: la vista previa se calla en vez de prometer lo que no sabe.
 */
function predictedConflicts(
  ours: readonly FileChange[],
  theirs: readonly FileChange[],
  fastForward: boolean,
): readonly string[] | null {
  if (fastForward) return [];

  const renamed = [...ours, ...theirs].some((change) => change.change === 'renamed');

  return renamed ? null : clashes(ours, theirs).map((clash) => clash.path);
}

/**
 * La vista previa de soltar una rama sobre otra, sin escribir nada.
 *
 * Las dos operaciones avanzan sin escribir historia nueva cuando el destino no
 * tiene commits propios: fusionar no tiene dos historias que unir y rebasar no
 * tiene nada que reescribir. Por eso el `fastForward` de las dos sale de la
 * misma cuenta.
 */
function previewOf(
  repo: MockRepo,
  kind: 'merge' | 'rebase',
  source: string,
  target: string,
): IntegrationPreview {
  const from = branchOrThrow(repo, source);
  const onto = branchOrThrow(repo, target);

  const ours = commitsBetween(repo, onto.tip, from.tip);
  const theirs = commitsBetween(repo, from.tip, onto.tip);
  const fastForward = ours.length === 0;

  return {
    kind,
    source,
    target,
    // Fusionar trae los commits del origen; rebasar reescribe los del destino.
    commits: kind === 'merge' ? theirs : ours,
    fastForward,
    conflicts: predictedConflicts(
      filesTouched(repo, ours),
      filesTouched(repo, theirs),
      fastForward,
    ),
    precondition: {
      sourceRef: source,
      targetRef: target,
      sourceOid: from.tip,
      targetOid: onto.tip,
    },
  };
}

/** Lo que la rama lleva de más y de menos respecto de su remota. */
function recount(branches: readonly Branch[], history: History, branch: Branch, tip: Sha): Branch {
  const remote =
    branch.upstream === undefined
      ? undefined
      : branches.find(
          (candidate) => candidate.kind === 'remote' && candidate.name === branch.upstream,
        );

  const next = withoutMissingUpstream({ ...branch, tip, ahead: 0, behind: 0 });

  if (!remote) {
    if (branch.upstream !== undefined) next.upstreamMissing = true;
    return next;
  }

  return {
    ...next,
    ahead: countAhead(history.byShaLookup, tip, remote.tip),
    behind: countAhead(history.byShaLookup, remote.tip, tip),
  };
}

/**
 * Deja HEAD, su rama y su worktree apuntando a `sha`.
 *
 * No es el `moveHead` del commit: aquel suma uno a lo que hay por subir porque
 * sabe que acaba de encadenar un commit, y aquí la rama puede haber saltado
 * cinco de golpe o haberse reescrito entera, así que lo de más y lo de menos se
 * vuelve a contar recorriendo el grafo.
 */
function pointAt(repo: MockRepo, history: History, sha: Sha): MockRepo {
  const name = repo.refs.head.branch;
  const next: History =
    name === null ? history : { ...history, tips: new Map(history.tips).set(name, sha) };

  return {
    ...repo,
    history: next,
    refs: {
      ...repo.refs,
      head: { ...repo.refs.head, sha },
      branches: repo.refs.branches.map((branch) =>
        branch.kind === 'local' && branch.name === name
          ? recount(repo.refs.branches, next, branch, sha)
          : branch,
      ),
      worktrees: repo.refs.worktrees.map((worktree) =>
        worktree.path === repo.repository.path ? { ...worktree, head: sha } : worktree,
      ),
    },
  };
}

/**
 * El repositorio a medias, con sus archivos en conflicto de verdad.
 *
 * Guarda además cómo estaba antes de empezar, que es lo que `abortOperation`
 * restaura. Los archivos que chocaron salen de las dos listas del árbol y
 * entran en la de conflictos: mientras no se decidan no están ni preparados ni
 * sin preparar, están bloqueando.
 */
function stopWith(
  repo: MockRepo,
  operation: RepoOperation,
  found: readonly Clash[],
  ours: string,
  theirs: string,
): MockRepo {
  const conflicted = found.map(({ path, kind }) => ({
    ...fileChange(path, 'conflicted', seedFrom(`${path}:${ours}:${theirs}`)),
    conflict: kind,
  }));

  const conflicts = new Map(repo.conflicts);

  for (const change of conflicted) conflicts.set(change.path, conflictFor(change, ours, theirs));

  const taken = new Set(found.map((clash) => clash.path));
  const staging = new Map(repo.staging);

  for (const path of taken) staging.delete(path);

  return {
    ...repo,
    repository: { ...repo.repository, operation },
    status: statusOf(
      repo.status.staged.filter((change) => !taken.has(change.path)),
      repo.status.unstaged.filter((change) => !taken.has(change.path)),
      [...repo.status.conflicted, ...conflicted],
    ),
    conflicts,
    staging,
    beforeOperation: repo.beforeOperation ?? repo,
  };
}

/**
 * El fallo que cuenta la operación detenida.
 *
 * El cherry-pick y el revert salen como `merge.conflict`: el catálogo no les da
 * código propio porque lo que hay que contar es el mismo —dos lados tocaron las
 * mismas líneas— y la frase los nombra igual de bien con sus dos extremos.
 */
function conflictErrorFor(operation: RepoOperation, count: number): GitOperationError {
  if (operation.kind === 'none' || operation.kind === 'bisect') {
    return new GitOperationError('unknown', {}, { output: 'CONFLICT (content): merge conflict' });
  }

  const { source, target } = operation;
  const output = `CONFLICT (content): Merge conflict in ${String(count)} archivo(s)`;

  if (operation.kind === 'rebase') {
    return new GitOperationError(
      'rebase.conflict',
      { source, target, sha: shortSha(operation.sha ?? ''), count },
      { output },
    );
  }

  return new GitOperationError('merge.conflict', { source, target, count }, { output });
}

/** Trae `source` a la rama activa. */
function mergeIn(
  repo: MockRepo,
  source: Branch,
  options: { noFastForward?: boolean },
  sha: Sha,
  at: number,
): Integration {
  const target = headName(repo);
  const head = repo.refs.head.sha;
  const ours = commitsBetween(repo, head, source.tip);
  const theirs = commitsBetween(repo, source.tip, head);

  // Ya estaba dentro: fusionar lo que no trae nada no escribe ni falla.
  if (theirs.length === 0) return { repo, conflicts: [] };

  const found = clashes(filesTouched(repo, ours), filesTouched(repo, theirs));

  if (found.length > 0) {
    return {
      repo: stopWith(
        repo,
        { kind: 'merge', source: source.name, target },
        found,
        target,
        source.name,
      ),
      conflicts: found.map((clash) => clash.path),
    };
  }

  if (ours.length === 0 && options.noFastForward !== true) {
    return { repo: pointAt(repo, repo.history, source.tip), conflicts: [] };
  }

  const commit: Commit = {
    sha,
    parents: [head, source.tip],
    summary: MERGE_TEMPLATE.replace('{source}', source.name).replace('{target}', target),
    body: '',
    author: CONFIG_IDENTITY,
    authoredAt: at,
    committer: CONFIG_IDENTITY,
    committedAt: at,
  };

  const history = withCommitted(repo.history, commit, []);

  return { repo: pointAt({ ...repo, history }, history, sha), conflicts: [] };
}

/**
 * Reescribe los commits propios de la rama activa encima de `onto`.
 *
 * Los originales se van con los reescritos: un rebase deja huérfano lo que
 * había, y dejarlo en la lista de commits haría que la tabla enseñara cada
 * commit dos veces. Lo que permite volver es la pila de deshacer, que guarda el
 * repositorio entero, igual que el reflog guarda a dónde apuntaba HEAD.
 */
function rebaseIn(repo: MockRepo, onto: Branch, newSha: () => Sha, at: number): Integration {
  const source = headName(repo);
  const head = repo.refs.head.sha;
  const ours = commitsBetween(repo, head, onto.tip);
  const theirs = commitsBetween(repo, onto.tip, head);

  if (ours.length === 0) return { repo: pointAt(repo, repo.history, onto.tip), conflicts: [] };
  // Ya está encima: no hay base nueva a la que mudarse.
  if (theirs.length === 0) return { repo, conflicts: [] };

  // Los lados van al revés que en la fusión: durante un rebase el «nuestro» es
  // la base, y lo que se replica encima es lo de la rama.
  const found = clashes(filesTouched(repo, theirs), filesTouched(repo, ours));

  if (found.length > 0) {
    // El más viejo es el primero que se aplica, y por tanto donde se para.
    const stopped = ours[ours.length - 1]?.sha;

    return {
      repo: stopWith(
        repo,
        {
          kind: 'rebase',
          source,
          target: onto.name,
          ...(stopped === undefined ? {} : { sha: stopped }),
        },
        found,
        // Durante un rebase el lado «nuestro» es la base: lo que se replica
        // encima es lo de la rama, aunque sea de quien está sentado aquí.
        onto.name,
        source,
      ),
      conflicts: found.map((clash) => clash.path),
    };
  }

  let parent: Sha = onto.tip;
  let history = repo.history;

  for (const commit of [...ours].reverse()) {
    const sha = newSha();

    history = withCommitted(
      history,
      { ...commit, sha, parents: [parent], committer: CONFIG_IDENTITY, committedAt: at },
      filesOf(repo.history, commit.sha),
      commit.sha,
    );
    parent = sha;
  }

  return { repo: pointAt({ ...repo, history }, history, parent), conflicts: [] };
}

/** Revertir cambia de signo lo que el commit hizo: lo que sumó, resta. */
function invertChange(change: FileChange): FileChange {
  return {
    ...change,
    change:
      change.change === 'added' ? 'deleted' : change.change === 'deleted' ? 'added' : change.change,
    insertions: change.deletions,
    deletions: change.insertions,
  };
}

/**
 * Trae commits sueltos encima de la rama activa, tal cual o del revés.
 *
 * El otro lado aquí no es una rama: es lo que hay sin guardar. Traer un commit
 * encima de un archivo que se está editando es justo lo que git no combina
 * solo, y es lo que deja el árbol en conflicto.
 */
function pickIn(
  repo: MockRepo,
  commits: readonly Commit[],
  mode: 'cherryPick' | 'revert',
  newSha: () => Sha,
  at: number,
): Integration {
  const first = commits[0];

  if (first === undefined) return { repo, conflicts: [] };

  const target = headName(repo);
  const dirty = [...repo.status.staged, ...repo.status.unstaged];
  const found = clashes(dirty, filesTouched(repo, commits));

  if (found.length > 0) {
    return {
      repo: stopWith(
        repo,
        { kind: mode, source: shortSha(first.sha), target, sha: first.sha },
        found,
        target,
        shortSha(first.sha),
      ),
      conflicts: found.map((clash) => clash.path),
    };
  }

  let parent = repo.refs.head.sha;
  let history = repo.history;

  for (const commit of commits) {
    const sha = newSha();
    const files = filesOf(repo.history, commit.sha);

    const applied: Commit =
      mode === 'cherryPick'
        ? { ...commit, sha, parents: [parent], committer: CONFIG_IDENTITY, committedAt: at }
        : {
            sha,
            parents: [parent],
            summary: `Revertir «${commit.summary}»`,
            body: `Esto revierte el commit ${commit.sha}.`,
            author: CONFIG_IDENTITY,
            authoredAt: at,
            committer: CONFIG_IDENTITY,
            committedAt: at,
          };

    history = withCommitted(history, applied, mode === 'revert' ? files.map(invertChange) : files);
    parent = sha;
  }

  return { repo: pointAt({ ...repo, history }, history, parent), conflicts: [] };
}

/**
 * Mueve la rama atrás, y con ella lo que cada modo se lleve por delante.
 *
 * `--hard` no toca lo que git no sigue: un archivo sin seguimiento sobrevive al
 * más destructivo de los tres, que es exactamente lo que hace git y lo que el
 * diálogo de confirmación tiene derecho a prometer.
 */
function resetIn(repo: MockRepo, to: Sha, mode: ResetMode): MockRepo {
  if (!repo.history.byShaLookup.has(to)) throw missingObject(repo.repository, to);

  const moved = pointAt(repo, repo.history, to);

  if (mode === 'soft') return moved;

  let next = moved;

  for (const change of moved.status.staged) next = applyStaging(next, change.path, null);

  if (mode === 'mixed') return next;

  return {
    ...next,
    status: statusOf([], next.status.unstaged.filter(untracked), []),
    staging: new Map(),
    conflicts: new Map(),
  };
}

function untracked(change: FileChange): boolean {
  return change.change === 'untracked';
}

/**
 * Cierra lo que quedó a medias con el commit que le faltaba.
 *
 * Con archivos todavía en conflicto vuelve a lanzar el mismo fallo en vez de
 * cerrar en falso: continuar sin haber decidido es lo único que no puede
 * significar «continuar».
 */
function continueIn(repo: MockRepo, sha: Sha, at: number): MockRepo {
  const operation = repo.repository.operation;

  if (operation.kind === 'none' || operation.kind === 'bisect') return repo;

  if (repo.status.conflicted.length > 0) {
    throw conflictErrorFor(operation, repo.status.conflicted.length);
  }

  const source = branchNamed(repo, operation.source);
  const original =
    operation.sha === undefined ? undefined : repo.history.byShaLookup.get(operation.sha);

  const commit: Commit = {
    sha,
    parents:
      operation.kind === 'merge' && source
        ? [repo.refs.head.sha, source.tip]
        : [repo.refs.head.sha],
    summary:
      original?.summary ??
      MERGE_TEMPLATE.replace('{source}', operation.source).replace('{target}', operation.target),
    body: '',
    author: original?.author ?? CONFIG_IDENTITY,
    authoredAt: original?.authoredAt ?? at,
    committer: CONFIG_IDENTITY,
    committedAt: at,
  };

  const history = withCommitted(repo.history, commit, repo.status.staged);
  const staging = new Map(repo.staging);

  for (const change of repo.status.staged) staging.delete(change.path);

  return pointAt(
    {
      ...repo,
      history,
      repository: { ...repo.repository, operation: { kind: 'none' } },
      status: statusOf([], repo.status.unstaged, []),
      staging,
      conflicts: new Map(),
      beforeOperation: null,
    },
    history,
    sha,
  );
}

/**
 * Tira lo que quedó a medias.
 *
 * Con el antes guardado se vuelve exactamente ahí, que es lo que git puede
 * hacer porque nada se había escrito todavía. Sin él —`bitacora` nació en
 * conflicto y no tiene pasado que restaurar— lo honesto es soltar los
 * conflictos y la marca, y no fingir un estado anterior que nunca existió.
 */
function abortIn(repo: MockRepo): MockRepo {
  if (repo.repository.operation.kind === 'none') return repo;

  const before = repo.beforeOperation;

  if (before) return { ...before, undoStack: repo.undoStack, redoStack: repo.redoStack };

  return {
    ...repo,
    repository: { ...repo.repository, operation: { kind: 'none' } },
    status: statusOf(repo.status.staged, repo.status.unstaged, []),
    conflicts: new Map(),
    beforeOperation: null,
  };
}

function undoIn(repo: MockRepo): MockRepo {
  const [step, ...rest] = repo.undoStack;

  if (!step) return repo;
  if (!step.entry.undoable) throw new GitOperationError('undo.stale', {});

  return {
    ...step.before,
    undoStack: rest,
    redoStack: [{ entry: step.entry, before: repo }, ...repo.redoStack],
  };
}

function redoIn(repo: MockRepo): MockRepo {
  const [step, ...rest] = repo.redoStack;

  if (!step) return repo;
  if (!step.entry.undoable) throw new GitOperationError('undo.stale', {});

  return {
    ...step.before,
    redoStack: rest,
    undoStack: [{ entry: step.entry, before: repo }, ...repo.undoStack],
  };
}

/** Cuántos commits hay al otro lado esperando: es lo que el fetch va a traer. */
function incoming(repo: MockRepo): number {
  return repo.refs.branches
    .filter((branch) => branch.kind === 'local' && branch.upstreamMissing !== true)
    .reduce((total, branch) => total + branch.behind, 0);
}

/** Un commit no es un objeto: git cuenta también sus árboles y sus blobs. */
function objectsFor(commits: number): number {
  return commits * 9 + 4;
}

/**
 * Las fases de algo que viaja por la red, con su espera entre aviso y aviso.
 *
 * Es el mismo patrón del clon, y por la misma razón: cancelar aborta dentro de
 * una de esas esperas y rechaza con `OperationCancelledError`. Como nada se
 * escribe hasta que las fases terminan, cancelar a mitad no puede dejar el
 * mundo a medias.
 */
async function transfer(
  phases: readonly TransferProgress['phase'][],
  objects: number,
  onProgress: ((progress: TransferProgress) => void) | undefined,
  pause: () => Promise<void>,
): Promise<void> {
  for (const [index, phase] of phases.entries()) {
    await pause();

    // Mientras se cuentan los objetos nadie sabe cuántos son.
    onProgress?.(
      phase === 'counting'
        ? { phase, received: 0, total: null }
        : { phase, received: Math.round((objects * (index + 1)) / phases.length), total: objects },
    );
  }
}

/** El nombre de la remota sin su remoto delante: `origin/dev` es `dev`. */
function shortName(branch: Branch): string {
  return branch.remote === undefined ? branch.name : branch.name.slice(branch.remote.length + 1);
}

/**
 * Recuenta lo de más y lo de menos, y con `prune` limpia las remotas que ya no
 * están.
 *
 * En el falso no hay un remoto de verdad al otro lado, así que lo único que el
 * mundo sabe para podar es si la rama local con ese nombre sigue existiendo.
 * Con git de verdad quien lo dice es el remoto, y `F6.2` lo sustituye.
 */
function fetchIn(repo: MockRepo, remote: string | null, prune: boolean): MockRepo {
  const locals = new Set(
    repo.refs.branches.filter((branch) => branch.kind === 'local').map((branch) => branch.name),
  );

  const kept = prune
    ? repo.refs.branches.filter(
        (branch) =>
          branch.kind === 'local' ||
          (remote !== null && branch.remote !== remote) ||
          locals.has(shortName(branch)),
      )
    : repo.refs.branches;

  return withRefs(repo, {
    ...repo.refs,
    branches: kept.map((branch) =>
      branch.kind === 'local' ? recount(kept, repo.history, branch, branch.tip) : branch,
    ),
  });
}

/** Publicar deja la remota donde está la local: nada por subir y nada por traer. */
function pushIn(repo: MockRepo, name: string, remote: string): MockRepo {
  const local = localBranch(repo, name);

  if (!local) return repo;

  const upstream = local.upstream ?? `${remote}/${name}`;
  const tracked = repo.refs.branches.find(
    (branch) => branch.kind === 'remote' && branch.name === upstream,
  );

  const branches = repo.refs.branches.map((branch) =>
    branch === local
      ? withoutMissingUpstream({ ...branch, upstream, ahead: 0, behind: 0 })
      : branch === tracked
        ? { ...branch, tip: local.tip }
        : branch,
  );

  return withRefs(repo, {
    ...repo.refs,
    branches: tracked
      ? branches
      : [
          ...branches,
          {
            id: `refs/remotes/${upstream}`,
            name: upstream,
            kind: 'remote' as const,
            remote,
            tip: local.tip,
            ahead: 0,
            behind: 0,
            isHead: false,
          },
        ],
  });
}

function validateRemoteInput(repo: MockRepo, remote: Remote, sameRemote: boolean): void {
  const hasControl = (value: string) =>
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    });
  const invalidName =
    remote.name.length === 0 ||
    /[\s~^:?*[\]\\]/.test(remote.name) ||
    hasControl(remote.name) ||
    remote.name.includes('..') ||
    remote.name.endsWith('.');
  if (invalidName) throw new GitOperationError('remote.invalidName', { remote: remote.name });
  if (
    remote.fetchUrl.length === 0 ||
    remote.pushUrl.length === 0 ||
    hasControl(remote.fetchUrl) ||
    hasControl(remote.pushUrl)
  ) {
    throw new GitOperationError('remote.invalidUrl', { remote: remote.name });
  }
  if (!sameRemote && repo.refs.remotes.some((candidate) => candidate.name === remote.name)) {
    throw new GitOperationError('remote.exists', { remote: remote.name });
  }
}

function withRemotes(repo: MockRepo, remotes: readonly Remote[]): MockRepo {
  return {
    ...repo,
    refs: { ...repo.refs, remotes },
    repository: { ...repo.repository, remotes },
  };
}

function renameRemoteIn(repo: MockRepo, currentName: string, remote: Remote): MockRepo {
  const prefix = `${currentName}/`;
  const renamed = withRemotes(
    repo,
    repo.refs.remotes.map((candidate) => (candidate.name === currentName ? remote : candidate)),
  );
  return withRefs(renamed, {
    ...renamed.refs,
    branches: renamed.refs.branches.map((branch) => {
      if (branch.kind === 'remote' && branch.remote === currentName) {
        const leaf = branch.name.slice(prefix.length);
        const name = `${remote.name}/${leaf}`;
        return { ...branch, id: `refs/remotes/${name}`, name, remote: remote.name };
      }
      if (branch.kind === 'local' && branch.upstream?.startsWith(prefix)) {
        return { ...branch, upstream: `${remote.name}/${branch.upstream.slice(prefix.length)}` };
      }
      return branch;
    }),
  });
}

function removeRemoteIn(repo: MockRepo, name: string): MockRepo {
  const prefix = `${name}/`;
  const without = withRemotes(
    repo,
    repo.refs.remotes.filter((remote) => remote.name !== name),
  );
  return withRefs(without, {
    ...without.refs,
    branches: without.refs.branches.flatMap((branch) => {
      if (branch.kind === 'remote' && branch.remote === name) return [];
      if (branch.kind === 'local' && branch.upstream?.startsWith(prefix)) {
        const detached = { ...branch };
        delete detached.upstream;
        delete detached.upstreamMissing;
        detached.ahead = 0;
        detached.behind = 0;
        return [detached];
      }
      return [branch];
    }),
  });
}

/** La rama activa, siempre que siga a una remota: sin eso no hay de dónde traer. */
function trackedHeadOrThrow(repo: MockRepo): Branch {
  const name = repo.refs.head.branch;
  const branch = name === null ? undefined : localBranch(repo, name);

  if (!branch || branch.upstream === undefined) {
    throw new GitOperationError(
      'pull.noUpstream',
      { branch: headName(repo) },
      { output: 'fatal: no tracking information for the current branch' },
    );
  }

  return branch;
}

function withoutCheckout(branch: Branch): Branch {
  const next = { ...branch };

  delete next.checkedOutIn;

  return next;
}

function withoutMissingUpstream(branch: Branch): Branch {
  const next = { ...branch };
  delete next.upstreamMissing;
  return next;
}

function contentsOf(path: string, key: string): FileContents {
  const { binary, mediaType } = describePath(path);

  if (binary) {
    const random = createRandom(seedFrom(`archivo-binario:${path}:${key}`));

    return {
      path,
      text: null,
      binary: true,
      size: random.int(2_000, 240_000),
      mediaType,
      encoding: 'binary',
    };
  }

  const text = editedLines(path, key).lines.join('\n');

  return { path, text, binary: false, size: text.length, mediaType, encoding: 'utf-8' };
}

function indexContents(repo: MockRepo, path: string): FileContents {
  const file = contentsOf(path, 'worktree');
  if (file.binary) return file;
  const base = baseLines(path);
  const staged = repo.staging.get(path);
  const selected = (side: LineSide, line: number) =>
    staged === 'all' || (staged !== undefined && staged[side].has(line));
  const lines: string[] = [];
  let cursor = 0;
  for (const hunk of hunksOf(path)) {
    lines.push(...base.slice(cursor, hunk.oldStart - 1));
    for (const line of hunk.lines) {
      if (
        line.kind === 'context' ||
        (line.kind === 'removed' && line.oldLine !== null && !selected('old', line.oldLine)) ||
        (line.kind === 'added' && line.newLine !== null && selected('new', line.newLine))
      ) {
        lines.push(line.text);
      }
    }
    cursor = hunk.oldStart - 1 + hunk.oldLines;
  }
  lines.push(...base.slice(cursor));
  const text = lines.join('\n');
  return { ...file, text, size: new TextEncoder().encode(text).length };
}
