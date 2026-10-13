import type { GitPort } from '@core/ports/GitPort';
import type { LogPort } from '@core/ports/LogPort';
import { redactLogText } from '@core/domain/logPrivacy';
import { logOperation } from './logOperation';

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

function requestSummary(method: string, args: readonly unknown[]): string {
  const parts: string[] = [];
  const visit = (argument: unknown, key: string, depth = 0) => {
    if (depth > 3) return;
    if (['string', 'number', 'boolean'].includes(typeof argument))
      parts.push(`${key}=${redactLogText(String(argument)).slice(0, 1000)}`);
    else if (Array.isArray(argument)) {
      parts.push(`${key}.count=${argument.length}`);
      argument.slice(0, 20).forEach((item, index) => visit(item, `${key}[${index}]`, depth + 1));
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
    visit(argument, `arg${index}`);
  });
  return parts.join(' · ').slice(0, 10000);
}

function resultSummary(result: unknown): string {
  if (typeof result === 'string') return `texto: ${result.length} caracteres`;
  if (Array.isArray(result)) return `elementos=${result.length}`;
  const parts: string[] = [];
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
      if (Array.isArray(record[key])) parts.push(`${key}=${record[key].length}`);
    }
    // Commit IDs and current branch are useful; message, authors and file contents are excluded.
    for (const key of ['head', 'branch', 'sha'])
      if (typeof record[key] === 'string') parts.push(`${key}=${record[key]}`);
  }
  return parts.join(' · ') || 'completado';
}

export function instrumentGitPort(git: GitPort, log: LogPort): GitPort {
  return new Proxy(git, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property !== 'string' || typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const read = /^(read|list|watch|preview)/.test(property);
        const context = {
          ...(typeof args[0] === 'string' ? { repository: args[0] } : {}),
          request: requestSummary(property, args),
        };
        if (property === 'watchRepository' && typeof args[1] === 'function') {
          const listener = args[1] as (change: unknown) => void;
          args[1] = (change: unknown) => {
            log.write(
              'debug',
              'git.watch',
              'Cambios externos detectados; se actualizará el repositorio',
              undefined,
              { repository: context.repository, phase: 'event', result: JSON.stringify(change) },
            );
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
              ? `sha=${result}`
              : resultSummary(result),
        );
      };
    },
  });
}
