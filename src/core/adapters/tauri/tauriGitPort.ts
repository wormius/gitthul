import type { LogValue } from '@core/domain/logs';
import {
  GIT_ERROR_CODES,
  GitOperationError,
  OperationCancelledError,
  type GitErrorCode,
  type GitErrorParams,
} from '@core/domain/errors';
import type { FileContents, FileDiff } from '@core/domain/diff';
import type { CommitDetails, CommitPage, Person } from '@core/domain/commit';
import type { IntegrationPreview, RefsSnapshot } from '@core/domain/refs';
import type {
  PullResult,
  ReflogEntry,
  Repository,
  RepoSummary,
  TransferProgress,
  UndoEntry,
} from '@core/domain/repository';
import type { ConflictContents, FileChange, TreeEntry, WorkingStatus } from '@core/domain/status';
import type {
  AutoResolveResult,
  CloneProgress,
  GitPort,
  GitQuery,
  RepositoryChange,
} from '@core/ports/GitPort';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type ChannelFactory = (handler: (progress: TransferProgress) => void) => Promise<unknown>;
type WatchChannelFactory = (handler: (change: RepositoryChange) => void) => Promise<unknown>;
let cloneSequence = 0;
let watchSequence = 0;
let historySequence = 0;
let diffSequence = 0;
let previewSequence = 0;
let networkSequence = 0;

async function tauriInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<unknown>(command, args);
}

async function tauriChannel(handler: (progress: TransferProgress) => void): Promise<unknown> {
  const { Channel } = await import('@tauri-apps/api/core');
  return new Channel(handler);
}

async function tauriWatchChannel(handler: (change: RepositoryChange) => void): Promise<unknown> {
  const { Channel } = await import('@tauri-apps/api/core');
  return new Channel(handler);
}

/**
 * Convierte el rechazo serializado por Tauri en el mismo error de dominio que
 * ya consume la interfaz. Rust nunca envía una frase traducida.
 */
export function decodeTauriGitError(value: unknown): GitOperationError {
  if (!isRecord(value) || !isGitErrorCode(value.code) || !isRecord(value.params)) {
    return new GitOperationError('unknown', {}, { output: readable(value), cause: value });
  }

  const output = typeof value.output === 'string' ? value.output : undefined;
  return new GitOperationError(value.code, value.params as GitErrorParams[typeof value.code], {
    ...(output === undefined ? {} : { output }),
    ...(isRecord(value.diagnostic) ? { diagnostic: value.diagnostic as LogValue } : {}),
    cause: value,
  });
}

/**
 * El adaptador nativo conserva en el falso únicamente las superficies que aún
 * no han cruzado su corte vertical, como el detalle y los diffs entre commits.
 */
export function createTauriGitPort(
  fallback: GitPort,
  call: Invoke = tauriInvoke,
  makeChannel: ChannelFactory = tauriChannel,
  makeWatchChannel: WatchChannelFactory = tauriWatchChannel,
): GitPort {
  const query = async <T>(
    command: string,
    args: Record<string, unknown> | undefined,
    options?: GitQuery,
  ): Promise<T> => {
    throwIfCancelled(options);
    try {
      const result = await call(command, args);
      throwIfCancelled(options);
      return result as T;
    } catch (error) {
      throwIfCancelled(options);
      if (isRecord(error) && error.code === 'operation.cancelled')
        throw new OperationCancelledError();
      throw decodeTauriGitError(error);
    }
  };

  // Una escritura que ya llegó a Rust no se vuelve «cancelada» al regresar:
  // podría haber terminado y ocultar su resultado dejaría la interfaz vieja.
  const mutation = async <T>(
    command: string,
    args: Record<string, unknown>,
    options?: GitQuery,
  ): Promise<T> => {
    throwIfCancelled(options);
    try {
      return (await call(command, args)) as T;
    } catch (error) {
      if (isRecord(error) && error.code === 'operation.cancelled')
        throw new OperationCancelledError();
      throw decodeTauriGitError(error);
    }
  };

  return {
    ...fallback,
    integrationWritesAvailable: true,
    listRepositories: (options) =>
      query<readonly RepoSummary[]>('git_list_repositories', undefined, options),
    openRepository: (path, options) => query<Repository>('git_open_repository', { path }, options),
    createRepository: (path, options, queryOptions) =>
      query<Repository>('git_create_repository', { path, options }, queryOptions),
    cloneRepository: async (request, options) => {
      throwIfCancelled(options);
      const operationId = `clone-${Date.now()}-${cloneSequence++}`;
      const onProgress = await makeChannel((progress) => {
        request.onProgress?.(progress as CloneProgress);
      });
      const abort = () => {
        void call('git_cancel_clone', { operationId }).catch(() => undefined);
      };
      options?.signal?.addEventListener('abort', abort, { once: true });
      try {
        const { onProgress: _onProgress, ...nativeRequest } = request;
        const result = await call('git_clone_repository', {
          request: nativeRequest,
          operationId,
          onProgress,
        });
        throwIfCancelled(options);
        return result as Repository;
      } catch (error) {
        throwIfCancelled(options);
        if (isRecord(error) && error.code === 'operation.cancelled')
          throw new OperationCancelledError();
        throw decodeTauriGitError(error);
      } finally {
        options?.signal?.removeEventListener('abort', abort);
      }
    },
    forgetRepository: (id, options) => query<void>('git_forget_repository', { id }, options),
    markOpened: (id, at, options) =>
      query<void>('git_mark_opened', { id, at: at ?? null }, options),
    readRepository: (id, options) => query<Repository>('git_read_repository', { id }, options),
    readIdentity: (id, options) => query<Person | null>('git_read_identity', { id }, options),
    writeIdentity: (id, identity, options) =>
      mutation<Person>('git_write_identity', { id, identity }, options),
    watchRepository: async (id, listener, options) => {
      throwIfCancelled(options);
      const operationId = `watch-${Date.now()}-${watchSequence++}`;
      const onChange = await makeWatchChannel(listener);
      const stop = () => {
        void call('git_unwatch_repository', { operationId }).catch(() => undefined);
      };
      const abort = () => {
        stop();
      };
      options?.signal?.addEventListener('abort', abort, { once: true });
      try {
        await call('git_watch_repository', { id, operationId, onChange });
        if (options?.signal?.aborted) {
          stop();
          throw new OperationCancelledError();
        }
        return () => {
          options?.signal?.removeEventListener('abort', abort);
          stop();
        };
      } catch (error) {
        options?.signal?.removeEventListener('abort', abort);
        if (options?.signal?.aborted || error instanceof OperationCancelledError) {
          stop();
          throw new OperationCancelledError();
        }
        if (isRecord(error) && error.code === 'operation.cancelled')
          throw new OperationCancelledError();
        throw decodeTauriGitError(error);
      }
    },
    readStatus: (id, options) => query<WorkingStatus>('git_read_status', { id }, options),
    readConflict: (id, path, options) =>
      query<ConflictContents>(
        'git_read_conflict',
        { id, path, ...(options?.encoding === undefined ? {} : { encoding: options.encoding }) },
        options,
      ),
    readRefs: (id, options) => query<RefsSnapshot>('git_read_refs', { id }, options),
    readCommits: async (id, page, options) => {
      throwIfCancelled(options);
      const operationId = `history-${Date.now()}-${historySequence++}`;
      const abort = () => {
        void call('git_cancel_history', { operationId }).catch(() => undefined);
      };
      options?.signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = await call('git_read_commits', {
          id,
          page: page ?? null,
          operationId,
        });
        throwIfCancelled(options);
        return result as CommitPage;
      } catch (error) {
        throwIfCancelled(options);
        if (isRecord(error) && error.code === 'operation.cancelled')
          throw new OperationCancelledError();
        throw decodeTauriGitError(error);
      } finally {
        options?.signal?.removeEventListener('abort', abort);
      }
    },
    readCommit: (id, sha, options) => query<CommitDetails>('git_read_commit', { id, sha }, options),
    readDiffFiles: async (id, source, options) => {
      throwIfCancelled(options);
      const operationId = `diff-${Date.now()}-${diffSequence++}`;
      const abort = () => {
        void call('git_cancel_diff', { operationId }).catch(() => undefined);
      };
      options?.signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = await call('git_read_diff_files', { id, source, operationId });
        throwIfCancelled(options);
        return result as readonly FileChange[];
      } catch (error) {
        throwIfCancelled(options);
        if (isRecord(error) && error.code === 'operation.cancelled')
          throw new OperationCancelledError();
        throw decodeTauriGitError(error);
      } finally {
        options?.signal?.removeEventListener('abort', abort);
      }
    },
    readDiff: async (id, request, options) => {
      throwIfCancelled(options);
      const operationId = `diff-${Date.now()}-${diffSequence++}`;
      const abort = () => {
        void call('git_cancel_diff', { operationId }).catch(() => undefined);
      };
      options?.signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = await call('git_read_diff', { id, request, operationId });
        throwIfCancelled(options);
        return result as FileDiff;
      } catch (error) {
        throwIfCancelled(options);
        if (isRecord(error) && error.code === 'operation.cancelled')
          throw new OperationCancelledError();
        throw decodeTauriGitError(error);
      } finally {
        options?.signal?.removeEventListener('abort', abort);
      }
    },
    readFile: (id, path, at, options) =>
      query<FileContents>(
        'git_read_file',
        {
          id,
          path,
          at: at ?? null,
          ...(options?.blob === undefined ? {} : { blob: options.blob }),
          ...(options?.encoding === undefined ? {} : { encoding: options.encoding }),
        },
        options,
      ),
    readTree: (id, at, options) =>
      query<readonly TreeEntry[]>('git_read_tree', { id, at: at ?? null }, options),
    readFileHistory: (id, path, options) =>
      query<CommitDetails['commit'][]>('git_read_file_history', { id, path }, options),
    previewIntegration: async (id, kind, source, target, options) => {
      throwIfCancelled(options);
      const operationId = `preview-${Date.now()}-${previewSequence++}`;
      const abort = () => {
        void call('git_cancel_history', { operationId }).catch(() => undefined);
      };
      options?.signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = await call('git_preview_integration', {
          id,
          kind,
          source,
          target,
          operationId,
        });
        throwIfCancelled(options);
        return result as IntegrationPreview;
      } catch (error) {
        throwIfCancelled(options);
        if (isRecord(error) && error.code === 'operation.cancelled')
          throw new OperationCancelledError();
        throw decodeTauriGitError(error);
      } finally {
        options?.signal?.removeEventListener('abort', abort);
      }
    },
    merge: (id, source, options, queryOptions) => {
      const precondition = options?.precondition;
      if (precondition === undefined) {
        return Promise.reject(new GitOperationError('ref.stale', { ref: source }));
      }
      return mutation<Repository>(
        'git_merge',
        {
          id,
          source,
          options: { noFastForward: options?.noFastForward ?? false },
          precondition,
        },
        queryOptions,
      );
    },
    rebase: (id, onto, options, queryOptions) => {
      const precondition = options?.precondition;
      if (precondition === undefined) {
        return Promise.reject(new GitOperationError('ref.stale', { ref: onto }));
      }
      return mutation<Repository>('git_rebase', { id, onto, precondition }, queryOptions);
    },
    cherryPick: (id, shas, options, queryOptions) => {
      const precondition = options?.precondition;
      if (precondition === undefined) {
        return Promise.reject(new GitOperationError('ref.stale', { ref: 'HEAD' }));
      }
      return mutation<Repository>(
        'git_cherry_pick',
        {
          id,
          shas,
          precondition,
          mainline: options?.mainline ?? null,
        },
        queryOptions,
      );
    },
    revert: (id, shas, options, queryOptions) => {
      const precondition = options?.precondition;
      if (precondition === undefined) {
        return Promise.reject(new GitOperationError('ref.stale', { ref: 'HEAD' }));
      }
      return mutation<Repository>(
        'git_revert',
        {
          id,
          shas,
          precondition,
          mainline: options?.mainline ?? null,
        },
        queryOptions,
      );
    },
    reset: (id, to, mode, options, queryOptions) => {
      if (options === undefined) {
        return Promise.reject(new GitOperationError('ref.stale', { ref: 'HEAD' }));
      }
      return mutation<Repository>(
        'git_reset',
        {
          id,
          to,
          mode,
          expectedBranch: options.expectedBranch,
          precondition: options.precondition,
        },
        queryOptions,
      );
    },
    createStash: (id, message, options, queryOptions) => {
      if (options?.precondition === undefined) {
        return Promise.reject(new GitOperationError('ref.stale', { ref: 'HEAD' }));
      }
      return mutation<RefsSnapshot>('git_create_stash', { id, message, options }, queryOptions);
    },
    applyStash: (id, index, options, queryOptions) => {
      if (options?.precondition === undefined || options.expectedStash === undefined) {
        return Promise.reject(
          new GitOperationError('ref.stale', { ref: `stash@{${String(index)}}` }),
        );
      }
      return mutation<WorkingStatus>('git_apply_stash', { id, index, options }, queryOptions);
    },
    dropStash: (id, index, options, queryOptions) => {
      if (options?.expectedStash === undefined) {
        return Promise.reject(
          new GitOperationError('ref.stale', { ref: `stash@{${String(index)}}` }),
        );
      }
      return mutation<RefsSnapshot>(
        'git_drop_stash',
        { id, index, expectedStash: options.expectedStash },
        queryOptions,
      );
    },
    renameStash: (id, index, message, options, queryOptions) => {
      if (options?.expectedStash === undefined) {
        return Promise.reject(
          new GitOperationError('ref.stale', { ref: `stash@{${String(index)}}` }),
        );
      }
      return mutation<RefsSnapshot>(
        'git_rename_stash',
        { id, index, message, expectedStash: options.expectedStash },
        queryOptions,
      );
    },
    createBranch: (id, name, from, options, queryOptions) =>
      mutation<RefsSnapshot>(
        'git_create_branch',
        { id, name, from, options: options ?? {} },
        queryOptions,
      ),
    readReflog: (id, options) => query<readonly ReflogEntry[]>('git_read_reflog', { id }, options),
    recoverReflogEntry: (id, name, selector, expectedSha, options) =>
      mutation<RefsSnapshot>(
        'git_recover_reflog_entry',
        { id, name, selector, expectedSha },
        options,
      ),
    deleteBranch: (id, name, options, queryOptions) =>
      mutation<RefsSnapshot>(
        'git_delete_branch',
        { id, name, options: options ?? {} },
        queryOptions,
      ),
    renameBranch: (id, from, to, options, queryOptions) =>
      mutation<RefsSnapshot>(
        'git_rename_branch',
        { id, from, to, options: options ?? {} },
        queryOptions,
      ),
    createTag: (id, name, at, options, queryOptions) =>
      mutation<RefsSnapshot>(
        'git_create_tag',
        { id, name, at, options: options ?? {} },
        queryOptions,
      ),
    deleteTag: (id, name, options, queryOptions) =>
      mutation<RefsSnapshot>('git_delete_tag', { id, name, options: options ?? {} }, queryOptions),
    checkout: (id, target, options, queryOptions) =>
      mutation<RefsSnapshot>('git_checkout', { id, target, options: options ?? {} }, queryOptions),
    fetch: async (id, remote, options, queryOptions) => {
      throwIfCancelled(queryOptions);
      const operationId = `network-${Date.now()}-${networkSequence++}`;
      const onProgress = await makeChannel(options?.onProgress ?? (() => undefined));
      const abort = () => {
        void call('git_cancel_network', { operationId }).catch(() => undefined);
      };
      queryOptions?.signal?.addEventListener('abort', abort, { once: true });
      try {
        const { onProgress: _onProgress, ...nativeOptions } = options ?? {};
        const result = await call('git_fetch', {
          id,
          remote,
          options: nativeOptions,
          operationId,
          onProgress,
        });
        throwIfCancelled(queryOptions);
        return result as RefsSnapshot;
      } catch (error) {
        throwIfCancelled(queryOptions);
        if (isRecord(error) && error.code === 'operation.cancelled')
          throw new OperationCancelledError();
        throw decodeTauriGitError(error);
      } finally {
        queryOptions?.signal?.removeEventListener('abort', abort);
      }
    },
    pull: async (id, options, queryOptions) => {
      throwIfCancelled(queryOptions);
      const operationId = `network-${Date.now()}-${networkSequence++}`;
      const onProgress = await makeChannel(options?.onProgress ?? (() => undefined));
      const abort = () => {
        void call('git_cancel_network', { operationId }).catch(() => undefined);
      };
      queryOptions?.signal?.addEventListener('abort', abort, { once: true });
      try {
        const { onProgress: _onProgress, ...nativeOptions } = options ?? {};
        const result = await call('git_pull', {
          id,
          options: nativeOptions,
          operationId,
          onProgress,
        });
        throwIfCancelled(queryOptions);
        return result as PullResult;
      } catch (error) {
        throwIfCancelled(queryOptions);
        if (isRecord(error) && error.code === 'operation.cancelled')
          throw new OperationCancelledError();
        throw decodeTauriGitError(error);
      } finally {
        queryOptions?.signal?.removeEventListener('abort', abort);
      }
    },
    push: async (id, branch, options, queryOptions) => {
      throwIfCancelled(queryOptions);
      const operationId = `network-${Date.now()}-${networkSequence++}`;
      const onProgress = await makeChannel(options?.onProgress ?? (() => undefined));
      const abort = () => {
        void call('git_cancel_network', { operationId }).catch(() => undefined);
      };
      queryOptions?.signal?.addEventListener('abort', abort, { once: true });
      try {
        const { onProgress: _onProgress, ...nativeOptions } = options ?? {};
        const result = await call('git_push', {
          id,
          branch,
          options: nativeOptions,
          operationId,
          onProgress,
        });
        throwIfCancelled(queryOptions);
        return result as RefsSnapshot;
      } catch (error) {
        throwIfCancelled(queryOptions);
        if (isRecord(error) && error.code === 'operation.cancelled')
          throw new OperationCancelledError();
        throw decodeTauriGitError(error);
      } finally {
        queryOptions?.signal?.removeEventListener('abort', abort);
      }
    },
    createWorktree: (id, path, branch, options) =>
      mutation<RepoSummary>('git_create_worktree', { id, path, branch }, options),
    removeWorktree: (id, path, options, queryOptions) =>
      mutation<RefsSnapshot>('git_remove_worktree', { id, path, options }, queryOptions),
    lockWorktree: (id, path, locked, options) =>
      mutation<RefsSnapshot>('git_lock_worktree', { id, path, locked }, options),
    addRemote: (id, remote, options) =>
      mutation<RefsSnapshot>('git_add_remote', { id, remote }, options),
    updateRemote: (id, currentName, remote, expected, options) =>
      mutation<RefsSnapshot>('git_update_remote', { id, currentName, remote, expected }, options),
    removeRemote: (id, name, expected, options) =>
      mutation<RefsSnapshot>('git_remove_remote', { id, name, expected }, options),
    stage: (id, paths, options) => mutation<WorkingStatus>('git_stage', { id, paths }, options),
    unstage: (id, paths, options) => mutation<WorkingStatus>('git_unstage', { id, paths }, options),
    stageHunks: (id, request, options) =>
      mutation<WorkingStatus>('git_stage_hunks', { id, request }, options),
    unstageHunks: (id, request, options) =>
      mutation<WorkingStatus>('git_unstage_hunks', { id, request }, options),
    stageLines: (id, request, options) =>
      mutation<WorkingStatus>('git_stage_lines', { id, request }, options),
    unstageLines: (id, request, options) =>
      mutation<WorkingStatus>('git_unstage_lines', { id, request }, options),
    discardAll: (id, precondition, options) =>
      mutation<WorkingStatus>('git_discard_all', { id, precondition }, options),
    discard: (id, targets, options) =>
      mutation<WorkingStatus>('git_discard', { id, targets }, options),
    discardLines: (id, request, options) =>
      mutation<WorkingStatus>('git_discard_lines', { id, request }, options),
    resolveConflict: (id, path, content, options) =>
      mutation<WorkingStatus>(
        'git_resolve_conflict',
        {
          id,
          path,
          content,
          ...(options?.encoding === undefined ? {} : { encoding: options.encoding }),
          ...(options?.expectedRevision === undefined
            ? {}
            : { expectedRevision: options.expectedRevision }),
        },
        options,
      ),
    markConflictsResolved: (id, paths, options) =>
      mutation<WorkingStatus>('git_mark_conflicts_resolved', { id, paths }, options),
    markConflictResolved: (id, path, options) =>
      mutation<WorkingStatus>('git_mark_conflict_resolved', { id, path }, options),
    unresolveConflict: (id, path, options) =>
      mutation<WorkingStatus>('git_unresolve_conflict', { id, path }, options),
    keepSide: (id, path, side, options) =>
      mutation<WorkingStatus>('git_keep_side', { id, path, side }, options),
    autoResolve: (id, options) => mutation<AutoResolveResult>('git_auto_resolve', { id }, options),
    continueOperation: (id, options) =>
      mutation<Repository>('git_continue_operation', { id }, options),
    abortOperation: (id, options) => mutation<Repository>('git_abort_operation', { id }, options),
    quitOperation: (id, options) => mutation<Repository>('git_quit_operation', { id }, options),
    commit: (id, request, options) => mutation<string>('git_commit', { id, request }, options),
    readUndoStack: (id, options) =>
      query<{ undo: readonly UndoEntry[]; redo: readonly UndoEntry[] }>(
        'git_read_undo_stack',
        { id },
        options,
      ),
    undo: (id, options) => mutation<Repository>('git_undo', { id }, options),
    redo: (id, options) => mutation<Repository>('git_redo', { id }, options),
  };
}

function throwIfCancelled(query?: GitQuery): void {
  if (query?.signal?.aborted) throw new OperationCancelledError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGitErrorCode(value: unknown): value is GitErrorCode {
  return typeof value === 'string' && (GIT_ERROR_CODES as readonly string[]).includes(value);
}

function readable(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return 'Tauri rechazó la operación Git sin un error reconocido';
}
