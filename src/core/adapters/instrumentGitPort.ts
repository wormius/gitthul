import type { GitPort } from '@core/ports/GitPort';
import type { LogPort } from '@core/ports/LogPort';
import { boundLogText, redactKnownLogValues, redactLogText } from '@core/domain/logPrivacy';
import type { LogMetadata } from '@core/domain/logs';
import { logOperation, type OperationSummary } from './logOperation';

const LABELS: Record<string, string> = {
  listRepositories: 'listar repositorios',
  openRepository: 'abrir repositorio',
  createRepository: 'crear repositorio',
  cloneRepository: 'clonar repositorio',
  forgetRepository: 'retirar repositorio de la biblioteca',
  markOpened: 'guardar apertura',
  watchRepository: 'observar cambios del repositorio',
  readRepository: 'leer repositorio',
  readIdentity: 'leer identidad Git',
  writeIdentity: 'guardar identidad Git',
  readRefs: 'leer referencias',
  readCommits: 'leer historial',
  readCommit: 'leer commit',
  readStatus: 'leer estado de archivos',
  readDiff: 'leer diff',
  readDiffFiles: 'leer archivos de la comparación',
  readFile: 'leer archivo',
  readConflict: 'leer conflicto',
  readFileHistory: 'leer historial del archivo',
  readTree: 'leer árbol',
  stage: 'preparar archivos',
  unstage: 'quitar archivos del stage',
  stageHunks: 'preparar bloques',
  unstageHunks: 'quitar bloques del stage',
  stageLines: 'preparar líneas',
  unstageLines: 'quitar líneas del stage',
  discard: 'descartar archivos',
  discardAll: 'descartar todos los cambios',
  discardLines: 'descartar líneas',
  resolveConflict: 'guardar resolución de conflicto',
  markConflictsResolved: 'marcar conflictos resueltos',
  markConflictResolved: 'marcar conflicto resuelto',
  unresolveConflict: 'restaurar conflicto',
  keepSide: 'resolver con una versión del archivo',
  autoResolve: 'resolver conflictos automáticamente',
  ignorePath: 'agregar patrón a gitignore',
  commit: 'crear o enmendar commit',
  createBranch: 'crear rama',
  renameBranch: 'renombrar rama',
  deleteBranch: 'eliminar rama',
  setUpstream: 'configurar upstream',
  createTag: 'crear tag',
  deleteTag: 'eliminar tag',
  checkout: 'cambiar revisión',
  createStash: 'guardar stash',
  renameStash: 'renombrar stash',
  applyStash: 'aplicar stash',
  dropStash: 'eliminar stash',
  previewIntegration: 'previsualizar integración',
  merge: 'integrar con merge',
  rebase: 'integrar con rebase',
  cherryPick: 'aplicar commits con cherry-pick',
  revert: 'revertir commits',
  reset: 'restablecer rama con reset',
  continueOperation: 'continuar integración',
  abortOperation: 'abortar integración',
  quitOperation: 'terminar integración conservando cambios',
  fetch: 'traer referencias con fetch',
  pull: 'traer e integrar con pull',
  push: 'publicar con push',
  addRemote: 'agregar remoto',
  updateRemote: 'actualizar remoto',
  removeRemote: 'eliminar remoto',
  createWorktree: 'crear worktree',
  removeWorktree: 'eliminar worktree',
  lockWorktree: 'cambiar bloqueo del worktree',
  readUndoStack: 'leer puntos de recuperación',
  undo: 'deshacer operación',
  redo: 'rehacer operación',
  readReflog: 'leer reflog',
  recoverReflogEntry: 'recuperar revisión del reflog',
};
const QUIET_WRITES = /^(stage|unstage|markOpened|renameStash|writeIdentity)/;
const LONG_OPERATIONS = new Set(['cloneRepository', 'fetch', 'pull', 'push']);
const PARAMETERS: Record<string, readonly string[]> = {
  openRepository: ['path'],
  createRepository: ['path', 'options'],
  cloneRepository: ['request'],
  readCommit: ['repository', 'sha'],
  readFile: ['repository', 'path', 'revision', 'query'],
  readConflict: ['repository', 'path'],
  readFileHistory: ['repository', 'path'],
  readDiff: ['repository', 'request'],
  readDiffFiles: ['repository', 'source'],
  readCommits: ['repository', 'page'],
  readTree: ['repository', 'revision'],
  stage: ['repository', 'paths'],
  unstage: ['repository', 'paths'],
  discard: ['repository', 'targets'],
  stageHunks: ['repository', 'request'],
  unstageHunks: ['repository', 'request'],
  stageLines: ['repository', 'request'],
  unstageLines: ['repository', 'request'],
  discardLines: ['repository', 'request'],
  discardAll: ['repository', 'precondition'],
  resolveConflict: ['repository', 'path'],
  markConflictsResolved: ['repository', 'paths'],
  markConflictResolved: ['repository', 'path'],
  unresolveConflict: ['repository', 'path'],
  keepSide: ['repository', 'path', 'side'],
  ignorePath: ['repository', 'pattern'],
  commit: ['repository', 'request'],
  createBranch: ['repository', 'branch', 'source', 'options'],
  renameBranch: ['repository', 'from', 'to', 'options'],
  deleteBranch: ['repository', 'branch', 'options'],
  setUpstream: ['repository', 'branch', 'upstream'],
  createTag: ['repository', 'tag', 'source', 'options'],
  deleteTag: ['repository', 'tag', 'options'],
  checkout: ['repository', 'target', 'options'],
  createStash: ['repository', 'message', 'options'],
  renameStash: ['repository', 'index', 'message', 'options'],
  applyStash: ['repository', 'index', 'options'],
  dropStash: ['repository', 'index', 'options'],
  previewIntegration: ['repository', 'kind', 'source', 'target'],
  merge: ['repository', 'source', 'options'],
  rebase: ['repository', 'onto', 'options'],
  cherryPick: ['repository', 'shas', 'options'],
  revert: ['repository', 'shas', 'options'],
  reset: ['repository', 'to', 'mode', 'options'],
  fetch: ['repository', 'remote', 'options'],
  pull: ['repository', 'options'],
  push: ['repository', 'branch', 'options'],
  addRemote: ['repository', 'remote'],
  updateRemote: ['repository', 'name', 'remote', 'precondition'],
  removeRemote: ['repository', 'name', 'precondition'],
  createWorktree: ['repository', 'path', 'branch'],
  removeWorktree: ['repository', 'path'],
  lockWorktree: ['repository', 'path', 'locked'],
};
const SAFE_KEYS = new Set([
  'path',
  'name',
  'branch',
  'remote',
  'tag',
  'kind',
  'index',
  'sha',
  'to',
  'from',
  'oid',
  'blob',
  'before',
  'after',
  'side',
  'line',
  'context',
  'amendMessageOnly',
  'mode',
  'amend',
  'expectedBranch',
  'head',
  'indexTree',
  'worktreeTree',
  'targetRef',
  'targetOid',
  'expectedTip',
  'expectedRemoteTip',
  'expectedLocalTip',
  'expectedStash',
  'expectedRevision',
  'initialBranch',
  'force',
  'prune',
  'strategy',
  'mainline',
  'drop',
  'autoStash',
  'remoteMode',
  'includeUntracked',
  'keepStaged',
  'checkout',
  'noFastForward',
  'untrack',
  'setUpstream',
  'ignoreWhitespace',
  'encoding',
  'cursor',
  'limit',
  'start',
  'fetchUrl',
  'pushUrl',
  'url',
]);

function requestSummary(method: string, args: readonly unknown[]): OperationSummary {
  const parts: string[] = [];
  const data: LogMetadata = {};
  const visit = (argument: unknown, key: string, depth = 0) => {
    if (depth > 4) {
      data[`${key}.truncated`] = true;
      return;
    }
    if (argument === null || ['string', 'number', 'boolean'].includes(typeof argument)) {
      const safe =
        typeof argument === 'string'
          ? boundLogText(redactLogText(argument), 1000)
          : (argument as null | number | boolean);
      data[key] = safe;
      parts.push(`${key}=${String(safe)}`);
    } else if (Array.isArray(argument)) {
      data[`${key}.count`] = argument.length;
      parts.push(`${key}.count=${argument.length}`);
      argument.slice(0, 20).forEach((item, index) => visit(item, `${key}[${index}]`, depth + 1));
      if (argument.length > 20) data[`${key}.omittedCount`] = argument.length - 20;
    } else if (argument && typeof argument === 'object') {
      for (const [field, value] of Object.entries(argument)) {
        if (
          SAFE_KEYS.has(field) ||
          ['source', 'precondition', 'target', 'paths', 'hunkIds', 'lines'].includes(field)
        )
          visit(value, `${key}.${field}`, depth + 1);
      }
    }
  };
  args.forEach((argument, index) => {
    // Positional free text is never safe, even when it has no recognizable secret pattern.
    if (
      (method === 'resolveConflict' && index === 2) ||
      (method === 'createStash' && index === 1) ||
      (method === 'renameStash' && index === 2) ||
      (method === 'writeIdentity' && index === 1)
    )
      return;
    visit(argument, PARAMETERS[method]?.[index] ?? (index === 0 ? 'repository' : `arg${index}`));
  });
  return { text: boundLogText(parts.join(' · '), 10000), data };
}

function resultSummary(result: unknown): OperationSummary {
  if (typeof result === 'string')
    return { text: `texto: ${result.length} caracteres`, data: { characters: result.length } };
  if (Array.isArray(result))
    return { text: `elementos=${result.length}`, data: { count: result.length } };
  const parts: string[] = [];
  const data: LogMetadata = {};
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    for (const key of [
      'commits',
      'files',
      'staged',
      'unstaged',
      'conflicted',
      'branches',
      'tags',
      'remotes',
      'stashes',
      'worktrees',
      'resolved',
      'undo',
      'redo',
    ]) {
      if (Array.isArray(record[key])) {
        parts.push(`${key}=${record[key].length}`);
        data[`${key}Count`] = record[key].length;
      }
    }
    // Commit IDs and current branch are useful; message, authors and file contents are excluded.
    for (const key of ['head', 'branch', 'sha', 'id'])
      if (typeof record[key] === 'string') {
        parts.push(`${key}=${record[key]}`);
        data[key] = record[key];
      }
    for (const key of [
      'binary',
      'size',
      'encoding',
      'detectedEncoding',
      'decodingErrors',
      'hasMore',
      'total',
    ])
      if (['string', 'number', 'boolean'].includes(typeof record[key]))
        data[key] = record[key] as string | number | boolean;
    if (record['content'] && typeof record['content'] === 'object') {
      const content = record['content'] as Record<string, unknown>;
      for (const key of [
        'kind',
        'encoding',
        'detectedEncoding',
        'decodingErrors',
        'truncated',
        'supportsPartial',
        'oldSize',
        'newSize',
      ])
        if (content[key] === null || ['string', 'number', 'boolean'].includes(typeof content[key]))
          data[`diff.${key}`] = content[key] as string | number | boolean | null;
      if (Array.isArray(content['hunks'])) data['hunkCount'] = content['hunks'].length;
    }
    if (Array.isArray(record['branches']))
      data['upstreamMissingCount'] = record['branches'].filter(
        (branch: unknown) =>
          branch &&
          typeof branch === 'object' &&
          'upstreamMissing' in branch &&
          branch.upstreamMissing === true,
      ).length;
  }
  return { text: parts.join(' · ') || 'completado', data };
}

function privateInputs(method: string, args: readonly unknown[]): string[] {
  const values: unknown[] = [];
  if (method === 'resolveConflict' || method === 'renameStash') values.push(args[2]);
  if (method === 'createStash') values.push(args[1]);
  if (
    (method === 'commit' || method === 'writeIdentity') &&
    args[1] &&
    typeof args[1] === 'object'
  ) {
    const record = args[1] as Record<string, unknown>;
    values.push(record['summary'], record['body'], record['name'], record['email']);
    if (record['author'] && typeof record['author'] === 'object') {
      const author = record['author'] as Record<string, unknown>;
      values.push(author['name'], author['email']);
    }
  }
  if (method === 'createTag' && args[3] && typeof args[3] === 'object')
    values.push((args[3] as Record<string, unknown>)['message']);
  return values.filter((value): value is string => typeof value === 'string');
}

export function instrumentGitPort(git: GitPort, log: LogPort): GitPort {
  return new Proxy(git, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property !== 'string' || typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const read = /^(read|list|watch|preview)/.test(property);
        let request: OperationSummary = { text: '[unavailable request metadata]' };
        let privateValues: string[] = [];
        try {
          privateValues = privateInputs(property, args);
          request = requestSummary(property, args);
        } catch {
          /* Request inspection must not change the operation. */
        }
        const context = {
          ...(typeof args[0] === 'string' && !/^(openRepository|createRepository)$/.test(property)
            ? { repository: args[0] }
            : {}),
          request: request.text,
          requestData: request.data,
        };
        if (property === 'watchRepository' && typeof args[1] === 'function') {
          const listener = args[1] as (change: unknown) => void;
          args[1] = (change: unknown) => {
            try {
              log.write(
                'debug',
                'git.watch',
                'Cambios externos detectados; se actualizará el repositorio',
                undefined,
                {
                  repository: context.repository,
                  phase: 'event',
                  resultData: {
                    worktree: !!(
                      change &&
                      typeof change === 'object' &&
                      'worktree' in change &&
                      change.worktree
                    ),
                    git: !!(change && typeof change === 'object' && 'git' in change && change.git),
                  },
                },
              );
            } catch {
              /* Observing a change must survive a broken logger. */
            }
            listener(change);
          };
        }
        return logOperation(
          log,
          read ? 'git.read' : 'git.write',
          property,
          LABELS[property] ?? property,
          context,
          () => Reflect.apply(value, target, args) as Promise<unknown>,
          (result) => {
            if (read || QUIET_WRITES.test(property)) return 'debug';
            if (property === 'autoResolve' && result && typeof result === 'object') {
              const resolved = (result as { resolved?: unknown }).resolved;
              if (Array.isArray(resolved) && resolved.length === 0) return 'debug';
            }
            return 'info';
          },
          (result) =>
            property === 'commit' && typeof result === 'string'
              ? { text: `sha=${result}`, data: { sha: result } }
              : resultSummary(result),
          (text) => redactKnownLogValues(text, privateValues),
          true,
          read ? undefined : LONG_OPERATIONS.has(property) ? 'info' : 'debug',
        );
      };
    },
  });
}
