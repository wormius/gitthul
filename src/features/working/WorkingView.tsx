import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGestures } from '@app/GestureContext';
import { GitErrorPanel } from '@app/GitErrorPanel';
import { usePorts } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import { activeTab, type WorkingBase } from '@app/tabs';
import { useAsyncData } from '@app/useAsyncData';
import type { Commit } from '@core/domain/commit';
import { shortSha } from '@core/domain/commit';
import {
  describeError,
  isCancelled,
  OperationCancelledError,
  toGitOperationError,
} from '@core/domain/errors';
import { stashName, type RefsSnapshot } from '@core/domain/refs';
import type { RepoId, Repository, UndoEntry } from '@core/domain/repository';
import type { WorkingStatus } from '@core/domain/status';
import type { GitQuery } from '@core/ports/GitPort';
import { ConflictLists } from '@features/resolve/ConflictLists';
import { useResolveStore } from '@features/resolve/resolveStore';
import { ThreeWayResolver } from '@features/resolve/ThreeWayResolver';
import { ResolvedResult } from '@features/resolve/ResolvedResult';
import { useI18n } from '@i18n/useI18n';
import { Checkbox } from '@ui/Checkbox';
import { EmptyState } from '@ui/EmptyState';
import { Banner } from '@ui/Banner';
import { Button } from '@ui/Button';
import { SplitPane } from '@ui/SplitPane';

import { BranchNameDialog } from './BranchNameDialog';
import { CommitDetails } from './CommitDetails';
import { CommitSequenceDialog } from './CommitSequenceDialog';
import { CommitTable, CommitTableSkeleton } from './CommitTable';
import { ComparePanel } from './ComparePanel';
import { ConfirmDialog } from './ConfirmDialog';
import { commitMenu, type MenuBuildContext } from './contextMenus';
import { DiffViewer } from './DiffViewer';
import { FileHistoryPanel } from './FileHistoryPanel';
import { GitActionBar } from './GitActionBar';
import { ActionPreview } from './ActionPreview';
import { OperationBanner } from './OperationBanner';
import { PushRejectedPanel } from './PushRejectedPanel';
import { PublishBranchDialog } from './PublishBranchDialog';
import { RefPanel, RefPanelSkeleton } from './RefPanel';
import { ResetDialog } from './ResetDialog';
import { RemoteBranchAheadDialog } from './RemoteBranchAheadDialog';
import { RemoteDialog } from './RemoteDialog';
import { RemoteCredentialsDialog } from './RemoteCredentialsDialog';
import { RecoveryDialog } from './RecoveryDialog';
import { StashDialog } from './StashDialog';
import { CommitComposer } from './CommitComposer';
import { StagingPanel } from './StagingPanel';
import { TagNameDialog } from './TagNameDialog';
import { useSectionCollapse } from './useSectionCollapse';
import { useWorkingActions } from './useWorkingActions';
import styles from './WorkingView.module.css';
import { useWorkingStore, type WorkingDialog } from './workingStore';
import { WorktreeDialog } from './WorktreeDialog';
import { useSettingsData } from '../settings/useSettingsData';
import { WorkingProgress } from './WorkingProgress';

interface WorkingData {
  repository: Repository;
  refs: RefsSnapshot;
  status: WorkingStatus;
  undoStack: { undo: readonly UndoEntry[]; redo: readonly UndoEntry[] };
}

/** Lo que una escritura ya devolvió y todavía no ha vuelto a leerse del puerto. */
interface WorkingPatch {
  repository?: Repository;
  refs?: RefsSnapshot;
  status?: WorkingStatus;
  undoStack?: { undo: readonly UndoEntry[]; redo: readonly UndoEntry[] };
}

interface WorkingViewProps {
  base: WorkingBase;
}

function resolutionOperationKey(
  data: Pick<WorkingData, 'repository' | 'refs' | 'status'>,
): string | null {
  const { operation } = data.repository;
  if (operation.kind !== 'none' && operation.kind !== 'bisect') {
    return JSON.stringify([
      operation.kind,
      operation.source,
      operation.target,
      operation.sha ?? '',
      data.refs.head.sha,
    ]);
  }

  if (data.status.recoveryOperation) {
    return JSON.stringify(['recovery', data.status.recoveryOperation, data.refs.head.sha]);
  }

  return data.status.conflicted.length > 0
    ? JSON.stringify(['standalone', data.refs.head.sha])
    : null;
}

/**
 * La vista GitWorking: los dos `SplitPane` anidados de la sección 1 del
 * subplan, con `RefPanel` en el izquierdo, `GitActionBar` + `CommitTable` en el
 * centro y —hasta F2.5— la lista de archivos cambiados en el derecho.
 *
 * Es también el único sitio donde se ejecutan las escrituras de los catorce
 * menús: aquí están los puertos y aquí está el estado que hay que dejar puesto
 * cuando una de ellas devuelve referencias nuevas.
 */
export function WorkingView({ base }: WorkingViewProps) {
  const searchNavigation = useShellStore((state) => state.searchNavigation);
  useEffect(() => {
    if (!searchNavigation || searchNavigation.repoId !== base.repoId) return;
    const working = useWorkingStore.getState();
    if (searchNavigation.kind === 'file') {
      if (searchNavigation.source === 'head') {
        working.openFileHistory(searchNavigation.path, undefined, true);
      } else {
        working.openDiff({
          path: searchNavigation.path,
          source: { kind: searchNavigation.source },
        });
      }
    } else if (searchNavigation.kind === 'stash') {
      const key = `stash:${searchNavigation.index}`;
      working.setSelectedCommits(new Set([key]));
      working.requestGoTo(searchNavigation.sha);
    } else {
      working.setSelectedCommits(new Set([searchNavigation.sha]));
      working.requestGoTo(searchNavigation.sha);
      if (searchNavigation.kind === 'ref') working.setSelectedRef(searchNavigation.ref);
    }
    useShellStore.setState({ searchNavigation: null });
  }, [base.repoId, searchNavigation]);
  const { t } = useI18n();
  const { git, system } = usePorts();
  const gestures = useGestures();

  const refsCollapsed = useWorkingStore((state) => state.refsCollapsed);
  const detailsCollapsed = useWorkingStore((state) => state.detailsCollapsed);
  const selectedCommits = useWorkingStore((state) => state.selectedCommits);
  const setSelectedCommits = useWorkingStore((state) => state.setSelectedCommits);
  const compare = useWorkingStore((state) => state.compare);
  const closeCompare = useWorkingStore((state) => state.closeCompare);
  const dialog = useWorkingStore((state) => state.dialog);
  const fileHistory = useWorkingStore((state) => state.fileHistory);
  const diff = useWorkingStore((state) => state.diff);
  const closeDiff = useWorkingStore((state) => state.closeDiff);
  const closeDialog = useWorkingStore((state) => state.closeDialog);
  const closeFileHistory = useWorkingStore((state) => state.closeFileHistory);
  const setContext = useWorkingStore((state) => state.setContext);
  const setNodeForm = useWorkingStore((state) => state.setNodeForm);
  const requestGoTo = useWorkingStore((state) => state.requestGoTo);
  const unload = useWorkingStore((state) => state.unload);
  const pendingWrites = useWorkingStore((state) => state.pendingWrites);
  const networkProgress = useWorkingStore((state) => state.networkProgress);

  const sections = useSectionCollapse();
  const { settings, patch: patchSettings } = useSettingsData();
  const persistWipName = useCallback(
    (name: string | null) => {
      const next = { ...settings.workingWipNames };
      const trimmed = name?.trim() ?? '';
      if (trimmed === '') delete next[base.repoId];
      else next[base.repoId] = trimmed;
      useWorkingStore.getState().setWipName(trimmed === '' ? null : trimmed);
      void patchSettings({ workingWipNames: next });
    },
    [base.repoId, patchSettings, settings.workingWipNames],
  );

  useEffect(() => {
    useWorkingStore.getState().setWipName(settings.workingWipNames[base.repoId] ?? null);
  }, [base.repoId, settings.workingWipNames]);

  const readEpoch = useRef(0);
  const metadataReads = useRef(0);
  const load = useCallback(
    async (query: GitQuery): Promise<WorkingData> => {
      const epoch = readEpoch.current;
      metadataReads.current += 1;
      try {
        const [repository, refs, status, undoStack] = await Promise.all([
          git.readRepository(base.repoId, query),
          git.readRefs(base.repoId, query),
          git.readStatus(base.repoId, query),
          git.readUndoStack(base.repoId, query),
        ]);
        if (epoch !== readEpoch.current || useWorkingStore.getState().pendingWrites > 0) {
          throw new OperationCancelledError();
        }
        return { repository, refs, status, undoStack };
      } finally {
        metadataReads.current -= 1;
      }
    },
    [git, base.repoId],
  );

  const data = useAsyncData(load);
  const loaded = data.status === 'ready' ? data.data : null;

  /*
   * Lo que las escrituras dejaron encima de lo leído.
   *
   * `GitPort` promete devolver el estado que cambió, así que renombrar una rama
   * no tiene por qué costar releer el repositorio entero ni pintar el esqueleto
   * otra vez. El parche se tira en cuanto llega una lectura nueva —ajuste de
   * estado durante el render, el patrón que ya usan `useAsyncData` y
   * `useCommitPages`—, porque a partir de ahí el dato fresco es el del puerto.
   */
  const [patch, setPatch] = useState<WorkingPatch>({});
  const [seen, setSeen] = useState(loaded);

  if (seen !== loaded) {
    setSeen(loaded);
    setPatch({});
  }

  const applyRefs = useCallback((refs: RefsSnapshot) => {
    setPatch((previous) => ({ ...previous, refs }));
  }, []);

  const applyStatus = useCallback((status: WorkingStatus) => {
    setPatch((previous) => ({ ...previous, status }));
  }, []);
  const applyUndoStack = useCallback(
    (undoStack: { undo: readonly UndoEntry[]; redo: readonly UndoEntry[] }) => {
      setPatch((previous) => ({ ...previous, undoStack }));
    },
    [],
  );
  const reload = data.reload;

  useEffect(() => {
    const lifecycle = new AbortController();
    let stop: (() => void) | undefined;
    let pendingStatus: AbortController | undefined;
    let deferredGit = false;
    let deferredWorktree = false;

    const refresh = (change: { git: boolean; worktree: boolean }) => {
      if (useWorkingStore.getState().pendingWrites > 0) {
        deferredGit ||= change.git;
        deferredWorktree ||= change.worktree;
        return;
      }
      if (change.git) {
        pendingStatus?.abort();
        useWorkingStore.getState().bumpHistory();
        reload({ retain: true });
        return;
      }
      if (!change.worktree) return;

      pendingStatus?.abort();
      const request = new AbortController();
      const epoch = readEpoch.current;
      pendingStatus = request;
      void git.readStatus(base.repoId, { signal: request.signal }).then(
        (fresh) => {
          if (
            !request.signal.aborted &&
            epoch === readEpoch.current &&
            useWorkingStore.getState().pendingWrites === 0
          ) {
            applyStatus(fresh);
          }
          if (pendingStatus === request) pendingStatus = undefined;
        },
        (error: unknown) => {
          if (!request.signal.aborted && !isCancelled(error)) reload();
          if (pendingStatus === request) pendingStatus = undefined;
        },
      );
    };

    // Invalidate synchronously at the start of a write, before React rerenders.
    // Watcher reads can observe stash push between its index/worktree cleanups.
    const stopWrites = useWorkingStore.subscribe((state, previous) => {
      if (state.pendingWrites === previous.pendingWrites) return;
      readEpoch.current += 1;
      deferredGit ||= metadataReads.current > 0;
      deferredWorktree ||= pendingStatus !== undefined;
      pendingStatus?.abort();
      pendingStatus = undefined;
      if (state.pendingWrites > 0) return;

      const change = { git: deferredGit, worktree: deferredWorktree };
      deferredGit = false;
      deferredWorktree = false;
      refresh(change);
    });

    void git
      .watchRepository(base.repoId, refresh, { signal: lifecycle.signal })
      .then((unsubscribe) => {
        if (lifecycle.signal.aborted) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((error: unknown) => {
        if (!lifecycle.signal.aborted && !isCancelled(error)) reload();
      });

    return () => {
      stopWrites();
      lifecycle.abort();
      pendingStatus?.abort();
      stop?.();
    };
  }, [applyStatus, base.repoId, git, reload]);

  const actions = useWorkingActions({
    repoId: base.repoId,
    repoPath: base.repoPath,
    applyRefs,
    applyStatus,
    applyUndoStack,
    setAllSectionsCollapsed: sections.setAll,
    setNodeForm,
    setWipName: persistWipName,
  });

  const refs = patch.refs ?? loaded?.refs ?? null;
  const status = patch.status ?? loaded?.status ?? null;
  const undoStack = useMemo(
    () => patch.undoStack ?? loaded?.undoStack ?? { undo: [], redo: [] },
    [loaded?.undoStack, patch.undoStack],
  );

  useEffect(() => {
    if (!status) return;
    if (!status.clean && selectedCommits.size === 0) {
      setSelectedCommits(new Set(['wip']));
      return;
    }
    if (status.clean && selectedCommits.has('wip')) {
      const next = new Set(selectedCommits);
      next.delete('wip');
      setSelectedCommits(next);
    }
  }, [selectedCommits, setSelectedCommits, status]);

  const menuContext = useMemo<MenuBuildContext>(
    () => ({
      t,
      actions,
      headBranch: refs?.head.branch ?? null,
      defaultRemote: refs?.remotes[0]?.name ?? null,
      branches: refs?.branches ?? [],
      ...(refs?.head.sha && (patch.repository ?? loaded?.repository)?.operation.kind === 'none'
        ? {
            amend: {
              sha: refs.head.sha,
              open: () => {
                const state = useWorkingStore.getState();
                if (
                  state.context?.repoId !== base.repoId ||
                  state.context.headSha !== refs.head.sha ||
                  state.context.canAmend === false
                )
                  return;
                state.requestCommit(true);
              },
            },
          }
        : {}),
    }),
    [actions, base.repoId, loaded?.repository, patch.repository, refs, t],
  );

  // Los gestos globales —`Mod+B`, `Mod+T`, `Mod+G`— viven fuera del árbol de
  // esta vista, así que lo mínimo que necesitan saber del repositorio abierto
  // se publica en el store.
  useEffect(() => {
    if (!loaded || !refs || !status) return;

    setContext({
      repoId: loaded.repository.id,
      repoName: loaded.repository.name,
      headBranch: refs.head.branch,
      headSha: refs.head.sha,
      resetPrecondition: status.resetPrecondition ?? {
        head: refs.head.sha,
        indexTree: null,
        worktreeTree: null,
      },
      headUpstream: (() => {
        const local = refs.branches.find((branch) => branch.kind === 'local' && branch.isHead);
        if (local?.upstreamMissing) return null;
        const upstream = refs.branches.find(
          (branch) => branch.kind === 'remote' && branch.name === local?.upstream,
        );
        return upstream?.remote
          ? { name: upstream.name, remote: upstream.remote, tip: upstream.tip }
          : null;
      })(),
      remoteNames: refs.remotes.map((remote) => remote.name),
      stagedCount: status.staged.length,
      canAmend: refs.head.sha !== '' && loaded.repository.operation.kind === 'none',
      hasWip: !status.clean,
      stashes: refs.stashes,
      trackedCount: status.conflicted.length + status.unstaged.length,
      undoCount: undoStack.undo[0]?.undoable ? undoStack.undo.length : 0,
      undoEntry: undoStack.undo[0],
      redoEntry: undoStack.redo[0],
      redoCount: undoStack.redo[0]?.undoable ? undoStack.redo.length : 0,
    });
  }, [loaded, refs, setContext, status, undoStack]);

  /*
   * Resolver — F3.1. Vive aquí porque aquí están los puertos: el registro de
   * gestos deja peticiones y esta vista las ejecuta, igual que con las de F2.8.
   */
  const setResolveCounts = useResolveStore((state) => state.setCounts);
  const resolvedPaths = useResolveStore((state) => state.resolvedPaths);
  const resolutionSources = useResolveStore((state) => state.resolutionSources);
  const resolutionOrigins = useResolveStore((state) => state.resolutionOrigins);
  const markResolved = useResolveStore((state) => state.markResolved);
  const restoreResolved = useResolveStore((state) => state.restoreResolved);
  const unmarkResolved = useResolveStore((state) => state.unmarkResolved);
  const markAutoResolved = useResolveStore((state) => state.markAutoResolved);
  const autoResolveDone = useResolveStore((state) => state.autoResolveDone);
  const setAutoResolveDone = useResolveStore((state) => state.setAutoResolveDone);
  const unresolveRequest = useResolveStore((state) => state.unresolveRequest);
  const clearUnresolveRequest = useResolveStore((state) => state.clearUnresolveRequest);
  const revertRequest = useResolveStore((state) => state.revertRequest);
  const clearRevertRequest = useResolveStore((state) => state.clearRevertRequest);
  const autoRequest = useResolveStore((state) => state.autoRequest);
  const unloadResolve = useResolveStore((state) => state.unload);

  const markConflictsResolved = useCallback(
    (paths: readonly string[]) => {
      if (paths.length === 0) return;

      void (async () => {
        await Promise.all(
          paths.map(async (path) => {
            const file = await git.readFile(base.repoId, path);
            const text = file.text ?? '';
            const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');

            useResolveStore.getState().setDraft(
              path,
              text,
              lines.map(() => 'context' as const),
            );
          }),
        );

        const next =
          paths.length === 1 && paths[0] !== undefined
            ? await git.markConflictResolved(base.repoId, paths[0])
            : await git.markConflictsResolved(base.repoId, paths);
        markResolved(paths);
        applyStatus(next);
      })();
    },
    [applyStatus, base.repoId, git, markResolved],
  );

  useEffect(() => {
    if (!status) return;

    setResolveCounts({
      conflicted: status.conflicted.length,
      resolved: status.staged.filter((change) => resolvedPaths.has(change.path)).length,
    });
  }, [resolvedPaths, setResolveCounts, status]);

  /*
   * CU-2: la autoresolución corre sola al entrar, y **una sola vez por
   * operación**. Si no resuelve nada no se dice nada: un aviso de «no pude
   * hacer nada por ti» es ruido.
   */
  useEffect(() => {
    if (autoResolveDone || status === null || status.conflicted.length === 0) return;

    setAutoResolveDone(true);

    void (async () => {
      const { resolved, status: next } = await git.autoResolve(base.repoId);

      markAutoResolved(resolved.map((entry) => entry.path));
      applyStatus(next);

      for (const entry of resolved) {
        const file = await git.readFile(base.repoId, entry.path);
        const text = file.text ?? '';
        const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');

        useResolveStore.getState().setDraft(
          entry.path,
          text,
          lines.map(() => 'context' as const),
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResolveDone, status]);

  const unresolveConflicts = useCallback(
    async (paths: readonly string[]) => {
      let next = null;

      for (const path of paths) next = await git.unresolveConflict(base.repoId, path);

      unmarkResolved(paths);

      const current = useResolveStore.getState();

      if (current.openPath !== null && paths.includes(current.openPath)) current.closeFile();
      if (next) applyStatus(next);
    },
    [applyStatus, base.repoId, git, unmarkResolved],
  );

  useEffect(() => {
    if (unresolveRequest === null) return;

    const { paths } = unresolveRequest;

    clearUnresolveRequest();

    void (async () => {
      await unresolveConflicts(paths);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolveRequest]);

  /*
   * Revertir a resuelto es la inversa de dejar sin resolver, y por eso solo
   * puede con lo que tiene borrador: sin él no hay resolución que devolver.
   */
  useEffect(() => {
    if (revertRequest === null) return;

    const { paths } = revertRequest;
    const drafts = useResolveStore.getState().drafts;

    clearRevertRequest();

    void (async () => {
      let next = null;
      const restored: string[] = [];

      for (const path of paths) {
        const draft = drafts.get(path);

        if (draft === undefined) continue;

        next = await git.resolveConflict(base.repoId, path, draft, {
          encoding: useResolveStore.getState().encodings.get(path),
        });
        restored.push(path);
      }

      markResolved(restored);
      if (next) applyStatus(next);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revertRequest]);

  useEffect(() => {
    if (autoRequest === 0) return;

    void (async () => {
      const { resolved, status: next } = await git.autoResolve(base.repoId);

      markAutoResolved(resolved.map((entry) => entry.path));
      applyStatus(next);

      for (const entry of resolved) {
        const file = await git.readFile(base.repoId, entry.path);
        const text = file.text ?? '';
        const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');

        useResolveStore.getState().setDraft(
          entry.path,
          text,
          lines.map(() => 'context' as const),
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRequest]);

  const openConflict = useResolveStore((state) => state.openPath);
  const openResolved = useResolveStore((state) => state.openResolved);
  const closeConflictFile = useResolveStore((state) => state.closeFile);
  const setDraft = useResolveStore((state) => state.setDraft);
  const openResolvedFile = useCallback(
    (path: string) => {
      void (async () => {
        const current = useResolveStore.getState();
        if (!current.drafts.has(path)) {
          const file = await git.readFile(base.repoId, path);
          const text = file.text ?? '';
          const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
          current.setDraft(
            path,
            text,
            lines.map(() => 'context' as const),
          );
        }
        openResolved(path);
      })();
    },
    [base.repoId, git, openResolved],
  );

  /*
   * Resolver un archivo: se escribe, pasa a Resueltos y se vuelve a las listas
   * — CU-8. El texto se guarda además como borrador, que es lo que deja que
   * «revertir a resuelto» pueda devolverlo después de dejarlo sin resolver.
   */
  /*
   * Escribe la resolución y devuelve a las listas. No toca el borrador: quien
   * lo puso fue el paso 2 al finalizar, y se conserva porque es lo que deja que
   * «revertir a resuelto» pueda devolver esta resolución si después se deja sin
   * resolver. Empieza por el `await` a propósito: llamarla desde un efecto no
   * puede escribir estado de forma síncrona.
   */
  const writeResolution = useCallback(
    async (path: string, text: string, revision?: string, encoding?: string) => {
      applyStatus(
        await git.resolveConflict(base.repoId, path, text, {
          ...(revision === undefined ? {} : { expectedRevision: revision }),
          ...(encoding === undefined ? {} : { encoding }),
        }),
      );
      markResolved([path]);
      closeConflictFile();
    },
    [applyStatus, base.repoId, closeConflictFile, git, markResolved],
  );

  const resolveStep = useResolveStore((state) => state.step);
  const drafts = useResolveStore((state) => state.drafts);
  const markResolvedRequest = useResolveStore((state) => state.markResolvedRequest);

  useEffect(() => {
    if (markResolvedRequest === 0) return;

    const { openPath, drafts: current } = useResolveStore.getState();
    const text = openPath === null ? undefined : current.get(openPath);

    if (openPath === null || text === undefined) return;

    // El `async` va aquí dentro y no en una función de fuera por lo mismo que
    // en los efectos de F2.8: lo primero que ocurre es la espera al puerto, no
    // una escritura de estado.
    void (async () => {
      applyStatus(
        await git.resolveConflict(base.repoId, openPath, text, {
          encoding: useResolveStore.getState().encodings.get(openPath),
        }),
      );
      markResolved([openPath]);
      closeConflictFile();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markResolvedRequest]);

  const keepSideOfOpenFile = useCallback(
    async (path: string, side: 'ours' | 'theirs') => {
      const conflict = await git.readConflict(base.repoId, path);
      const text = conflict[side] ?? '';
      const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');

      applyStatus(await git.keepSide(base.repoId, path, side));
      useResolveStore.getState().setDraft(
        path,
        text,
        lines.map(() => side),
      );
      markResolved([path]);
      closeConflictFile();
    },
    [applyStatus, base.repoId, closeConflictFile, git, markResolved],
  );

  const keepStagedRequest = useResolveStore((state) => state.keepStagedRequest);
  const handledKeepStagedRequest = useRef(keepStagedRequest);
  const keepStagedPending = useRef(false);

  useEffect(() => {
    if (keepStagedRequest === handledKeepStagedRequest.current) return;
    handledKeepStagedRequest.current = keepStagedRequest;
    if (keepStagedRequest === 0 || keepStagedPending.current) return;
    keepStagedPending.current = true;
    void (async () => {
      try {
        const repository = await git.quitOperation(base.repoId);
        const status = await git.readStatus(base.repoId);
        setPatch((previous) => ({ ...previous, repository, status }));
        setSelectedCommits(new Set(['wip']));
        closeDiff();
        reload({ retain: true });
        applyUndoStack(await git.readUndoStack(base.repoId));
      } catch (error) {
        if (!isCancelled(error)) {
          const described = describeError(toGitOperationError(error));
          useShellStore
            .getState()
            .setStatus({ tone: 'danger', key: described.titleKey, params: described.params });
          reload({ retain: true });
        }
      } finally {
        keepStagedPending.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keepStagedRequest]);

  // F2.8: peticiones de operaciones desde los gestos globales.
  const undoRequest = useWorkingStore((state) => state.undoRequest);
  const redoRequest = useWorkingStore((state) => state.redoRequest);
  const stashRequest = useWorkingStore((state) => state.stashRequest);
  const popRequest = useWorkingStore((state) => state.popRequest);
  const continueRequest = useWorkingStore((state) => state.continueRequest);
  const abortRequest = useWorkingStore((state) => state.abortRequest);
  const handledPopRequest = useRef(popRequest);
  const handledStashRequest = useRef(stashRequest);
  const handledUndoRequest = useRef(undoRequest);
  const handledRedoRequest = useRef(redoRequest);

  useEffect(() => {
    if (undoRequest === handledUndoRequest.current) return;
    handledUndoRequest.current = undoRequest;
    actions.undo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoRequest]);

  useEffect(() => {
    if (redoRequest === handledRedoRequest.current) return;
    handledRedoRequest.current = redoRequest;
    actions.redo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redoRequest]);

  useEffect(() => {
    if (stashRequest === handledStashRequest.current) return;
    handledStashRequest.current = stashRequest;
    if (status && !status.clean) {
      const wipName = useWorkingStore.getState().wipName;
      const branch = useWorkingStore.getState().context?.headBranch ?? 'HEAD';
      const message = wipName ?? t('working.stashDialog.message', { branch });

      actions.stash(message, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stashRequest]);

  useEffect(() => {
    if (popRequest === handledPopRequest.current) return;

    handledPopRequest.current = popRequest;
    const target = useWorkingStore.getState().popTarget;
    if (
      target &&
      refs?.stashes.some((stash) => stash.sha === target.sha && stash.index === target.index)
    ) {
      actions.pop(target, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popRequest]);

  useEffect(() => {
    if (continueRequest > 0) actions.continueOperation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueRequest]);

  useEffect(() => {
    if (abortRequest > 0) actions.abortOperation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abortRequest]);

  /*
   * Los gestos de archivo y el de checkout, que sí traen carga.
   *
   * Los de F2.8 y F2.9 son contadores porque no llevan nada consigo; estos dos
   * traen rutas o un nombre, así que siguen el patrón de `commitRequest`:
   * objeto con nonce, y quien lo atiende lo limpia. `stageAll` y `unstageAll`
   * no viajan con rutas porque quien las tiene delante es esta vista.
   */
  const fileRequest = useWorkingStore((state) => state.fileRequest);
  const clearFileRequest = useWorkingStore((state) => state.clearFileRequest);
  const checkoutRequest = useWorkingStore((state) => state.checkoutRequest);
  const clearCheckoutRequest = useWorkingStore((state) => state.clearCheckoutRequest);

  useEffect(() => {
    if (fileRequest === null || status === null) return;

    const { kind, paths } = fileRequest;

    if (kind === 'stage') actions.stage(paths);
    if (kind === 'unstage') actions.unstage(paths);
    if (kind === 'discard') actions.discard(paths);

    if (kind === 'stageAll') {
      actions.stage([...status.conflicted, ...status.unstaged].map((file) => file.path));
    }

    if (kind === 'unstageAll') actions.unstage(status.staged.map((file) => file.path));

    // Ignorar es una escritura por patrón, y el patrón de un archivo es su
    // ruta: varios marcados son varias entradas en `.gitignore`, no una.
    if (kind === 'ignore' || kind === 'ignoreUntrack') {
      for (const path of paths) actions.ignorePath(path, kind === 'ignoreUntrack');
    }

    clearFileRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileRequest]);

  useEffect(() => {
    if (checkoutRequest === null) return;

    actions.checkout(checkoutRequest.target, checkoutRequest.name);
    clearCheckoutRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutRequest]);

  // F2.9: peticiones de operaciones de red desde los gestos globales.
  const fetchRequest = useWorkingStore((state) => state.fetchRequest);
  const pullRequest = useWorkingStore((state) => state.pullRequest);
  const pushRequest = useWorkingStore((state) => state.pushRequest);
  const cancelNetworkRequest = useWorkingStore((state) => state.cancelNetworkRequest);
  const pushRejected = useWorkingStore((state) => state.pushRejected);
  const closePushRejected = useWorkingStore((state) => state.closePushRejected);

  const handledFetchRequest = useRef(fetchRequest);
  useEffect(() => {
    if (fetchRequest === handledFetchRequest.current) return;
    handledFetchRequest.current = fetchRequest;
    if (fetchRequest > 0) actions.fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRequest]);

  const handledPullRequest = useRef(pullRequest);
  useEffect(() => {
    if (pullRequest === handledPullRequest.current) return;
    handledPullRequest.current = pullRequest;
    if (pullRequest > 0) actions.pull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullRequest]);

  const handledPushRequest = useRef(pushRequest);
  useEffect(() => {
    if (pushRequest === handledPushRequest.current) return;
    handledPushRequest.current = pushRequest;
    if (pushRequest > 0) actions.push();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushRequest]);

  const handledCancelNetworkRequest = useRef(cancelNetworkRequest);
  useEffect(() => {
    if (cancelNetworkRequest === handledCancelNetworkRequest.current) return;
    handledCancelNetworkRequest.current = cancelNetworkRequest;
    if (cancelNetworkRequest > 0) actions.cancelNetwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelNetworkRequest]);

  const repository = patch.repository ?? loaded?.repository ?? null;
  const resolutionKey =
    repository && refs && status ? resolutionOperationKey({ repository, refs, status }) : null;
  const previousResolutionKey = useRef<string | null>(null);
  const operationInProgress =
    repository !== null &&
    repository.operation.kind !== 'none' &&
    repository.operation.kind !== 'bisect';
  const stashRecovery = operationInProgress ? undefined : status?.recoveryOperation;
  const hasConflicts = (status?.conflicted.length ?? 0) > 0;
  const standaloneConflict = !operationInProgress && stashRecovery === undefined && hasConflicts;
  const resolving =
    status !== null && (hasConflicts || stashRecovery !== undefined || operationInProgress);
  const blocked = resolving;
  const writeBlocked = pendingWrites > 0 && networkProgress === null;

  // Las decisiones de Resolver pertenecen únicamente a la operación Git vigente.
  useEffect(() => {
    if (previousResolutionKey.current === resolutionKey) return;

    previousResolutionKey.current = resolutionKey;
    unloadResolve();
  }, [resolutionKey, unloadResolve]);

  /*
   * La lista de resueltos es información de sesión, no algo que Git pueda
   * reconstruir del índice: ahí convive con archivos que ya estaban preparados.
   * Se recuperan solo rutas de la misma operación que sigan en stage y fuera de
   * conflictos. Los contenidos nunca se persisten; `openResolvedFile` los lee.
   */
  useEffect(() => {
    if (!repository || !status) return;

    const tab = activeTab(useShellStore.getState());
    if (!tab || tab.surface.kind !== 'working' || tab.surface.repoId !== base.repoId) return;

    if (resolutionKey === null) {
      restoreResolved([]);
      useShellStore.getState().updateWorkingResolution(tab.id, null);
      return;
    }

    const staged = new Set(status.staged.map((change) => change.path));
    const conflicted = new Set(status.conflicted.map((change) => change.path));
    const restored =
      base.resolution?.operation === resolutionKey
        ? base.resolution.paths.filter((path) => staged.has(path) && !conflicted.has(path))
        : [];

    restoreResolved(restored);
    const savedPaths = base.resolution?.paths ?? [];
    if (
      base.resolution?.operation !== resolutionKey ||
      savedPaths.length !== restored.length ||
      savedPaths.some((path, index) => path !== restored[index])
    ) {
      useShellStore
        .getState()
        .updateWorkingResolution(
          tab.id,
          restored.length > 0 ? { operation: resolutionKey, paths: restored } : null,
        );
    }

    return useResolveStore.subscribe((state, previous) => {
      if (state.resolvedPaths === previous.resolvedPaths) return;
      const paths = [...state.resolvedPaths];
      useShellStore
        .getState()
        .updateWorkingResolution(
          tab.id,
          paths.length > 0 ? { operation: resolutionKey, paths } : null,
        );
    });
    // La suscripción vive por operación. Cambios de status o de la propia
    // superficie persistida no deben rehidratar y pisar el estado en curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.repoId, resolutionKey, restoreResolved]);

  /*
   * Estas limpiezas van después de la suscripción de sesión: al desmontar,
   * primero se deja de persistir y luego se vacían las tiendas efímeras. De
   * otro modo, cerrar la ventana guardaría por accidente una lista vacía.
   */
  useEffect(() => () => unloadResolve(), [unloadResolve]);

  // CU-17: al perder el foco la pestaña se libera lo pesado, y con ello lo que
  // apuntaba a este repositorio en concreto — selección, diálogo, historial.
  useEffect(() => () => unload(), [unload]);

  /*
   * El arreglo `locateRepo` de `repo.notFound`: elige otra carpeta, la suma y
   * abandona la entrada vieja, igual que hace `useRepositoryActions.locate`
   * para Repositorios. Aquí además cierra esta pestaña y abre la del
   * repositorio encontrado, porque la que había apuntaba a un `repoId` que ya
   * no existe.
   */
  const locate = () => {
    void (async () => {
      try {
        const path = await system.pickDirectory();

        if (path === null) return;

        const found = await git.openRepository(path);

        await git.forgetRepository(base.repoId);

        const tabId = activeTab(useShellStore.getState())?.id;

        if (tabId) useShellStore.getState().closeTab(tabId);

        useShellStore.getState().openWorking({
          repoId: found.id,
          repoName: found.name,
          repoPath: found.path,
          branch: found.head,
          ...(found.worktreeOf === undefined ? {} : { worktreeOf: found.worktreeOf }),
        });
      } catch (error) {
        if (isCancelled(error)) return;

        data.reload();
      }
    })();
  };

  const forget = () => {
    void (async () => {
      try {
        await git.forgetRepository(base.repoId);

        const tabId = activeTab(useShellStore.getState())?.id;

        if (tabId) useShellStore.getState().closeTab(tabId);
      } catch (error) {
        if (isCancelled(error)) return;

        data.reload();
      }
    })();
  };

  const left =
    data.status === 'loading' ? (
      <RefPanelSkeleton />
    ) : data.status === 'failed' ? (
      <div className={styles.leftError}>
        <GitErrorPanel
          error={data.error}
          fixes={{ retry: data.reload, locateRepo: locate, forgetRepo: forget }}
        />
      </div>
    ) : refs ? (
      <RefPanel
        repository={data.data.repository}
        refs={refs}
        collapsed={refsCollapsed}
        onCollapsedChange={() => {
          gestures.run('working.toggleRefs');
        }}
        sections={sections}
        menuContext={menuContext}
        onGoToHead={() => {
          setSelectedCommits(new Set([refs.head.sha]));
          requestGoTo(refs.head.sha);
        }}
      />
    ) : null;

  // Sin tabla propia cuando falla la lectura del repositorio entero: el panel
  // izquierdo ya enseña ese error con sus arreglos —Reintentar, Localizar,
  // Olvidar—, y repetirlo en el centro sería el mismo texto dos veces en la
  // misma pantalla.
  const body =
    data.status === 'loading' ? (
      <CommitTableSkeleton />
    ) : data.status === 'failed' || !refs || !status ? null : (
      <CommitTable
        repoId={base.repoId}
        repoName={data.data.repository.name}
        status={status}
        refs={refs}
        menuContext={menuContext}
        actions={actions}
        onRenameWip={persistWipName}
      />
    );

  const commitMenuFor = useCallback(
    (commit: Commit) => commitMenu(menuContext, commit),
    [menuContext],
  );

  /*
   * El visor de diff se superpone a la tabla en esa caja y no en el reparto de
   * `SplitPane`: la barra de acciones y los dos paneles laterales siguen vivos
   * mientras se lee un diff. El historial de archivo vive ahora en el panel
   * derecho, para poder cambiar de versión sin cerrar este visor.
   */
  const center = (
    <div className={styles.center}>
      <div
        className={[styles.actionBarSlot, blocked ? styles.blockedSurface : '']
          .filter(Boolean)
          .join(' ')}
        inert={blocked}
      >
        <GitActionBar />
      </div>
      {blocked &&
        (repository?.operation.kind === 'none' || repository?.operation.kind === 'bisect') &&
        status !== null && (
          <div className={styles.conflictBanner}>
            <Banner
              variant="warning"
              title={
                status.recoveryOperation
                  ? t('working.operationBanner.conflictGenerated', {
                      operation: t(
                        status.recoveryOperation === 'pop'
                          ? 'working.operationBanner.kind.pop'
                          : 'working.operationBanner.kind.stashApply',
                      ),
                    })
                  : t(status.conflicted.length === 1 ? 'resolve.focus.one' : 'resolve.focus.many', {
                      count: status.conflicted.length,
                    })
              }
              actions={
                <div className={styles.conflictActions}>
                  {status.recoveryOperation && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className={styles.dangerAction}
                      onClick={actions.abortOperation}
                    >
                      {t('working.operationBanner.abortKind', {
                        operation: t(
                          status.recoveryOperation === 'pop'
                            ? 'working.operationBanner.kind.pop'
                            : 'working.operationBanner.kind.stashApply',
                        ),
                      })}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      markConflictsResolved(status.conflicted.map((file) => file.path));
                    }}
                  >
                    {t('resolve.mark.all')}
                  </Button>
                </div>
              }
            >
              {t('resolve.focus.detail')}
            </Banner>
          </div>
        )}
      {repository !== null &&
        repository.operation.kind !== 'none' &&
        repository.operation.kind !== 'bisect' && (
          <div className={styles.operationBanner}>
            <OperationBanner
              operation={repository.operation}
              hasConflicts={(status?.conflicted.length ?? 0) > 0}
              onContinue={actions.continueOperation}
              onAbort={actions.abortOperation}
              onMarkAllResolved={() => {
                markConflictsResolved(status?.conflicted.map((file) => file.path) ?? []);
              }}
            />
          </div>
        )}
      <div
        className={[styles.body, blocked ? styles.blockedSurface : ''].filter(Boolean).join(' ')}
        inert={blocked}
      >
        {body}
        {diff !== null && (
          <DiffViewer
            repoId={base.repoId}
            diff={diff}
            actions={actions}
            status={status}
            onClose={closeDiff}
          />
        )}
      </div>
    </div>
  );

  /*
   * El panel derecho — CU-4, CU-6, CU-7, CU-14.
   *
   * `compare` manda sobre la selección. Una rama lo abre desde su acción; dos
   * o más commits lo abren en el mismo cambio de selección. Con exactamente un
   * commit marcado y sin comparación en curso, `CommitDetails`. El estado de
   * varios marcados queda como respaldo para selecciones mixtas que incluyen
   * WIP o stash, porque esos nodos no son commits comparables. Sin nada
   * seleccionado, `StagingPanel`.
   */
  /*
   * La clave de una fila no siempre es un SHA: WIP usa `'wip'` y un guardado
   * `stash:N` (ver `commits.ts`). WIP conserva `StagingPanel`; un guardado se
   * resuelve a su SHA para que el detalle lea sus archivos incluidos.
   */
  const commitDraft = useWorkingStore((state) => state.commitDraft);
  const commitRequest = useWorkingStore((state) => state.commitRequest);
  const editingAmend = commitDraft.amend || commitRequest?.amend === true;
  const onlySelected = selectedCommits.size === 1 ? [...selectedCommits][0] : undefined;
  const singleSelected =
    onlySelected !== undefined && onlySelected !== 'wip' && !onlySelected.startsWith('stash:')
      ? onlySelected
      : undefined;
  const selectedStash = onlySelected?.startsWith('stash:')
    ? refs?.stashes.find((stash) => `stash:${String(stash.index)}` === onlySelected)
    : undefined;
  const headBranch = refs?.branches.find((branch) => branch.isHead) ?? null;
  const headName = refs ? (refs.head.branch ?? shortSha(refs.head.sha)) : '';

  /*
   * Solo la selección múltiple sin comparación pinta un `EmptyState` centrado.
   * WIP y los guardados no son SHA, pero sí montan `StagingPanel`, que tiene que
   * ocupar el panel completo igual que `CommitDetails`.
   */
  const centered = fileHistory === null && compare === null && selectedCommits.size > 1;

  /*
   * Las dos ramas de la operación a medias. `bisect` y `none` no tienen dos que
   * nombrar, y ahí tampoco puede haber conflictos que resolver, pero la
   * invariante 5 no admite un rótulo genérico: si no hay nombres, se usa el de
   * la rama activa a los dos lados antes que decir «esta rama».
   */
  const operation = loaded?.repository.operation ?? { kind: 'none' as const };
  const operationSides =
    operation.kind !== 'none' && operation.kind !== 'bisect'
      ? { ours: operation.target, theirs: operation.source }
      : { ours: headName, theirs: headName };

  /*
   * Resolver es un estado de esta vista, no una vista aparte — decisión 1 del
   * subplan. Con conflictos, el panel derecho enseña sus dos listas y la tabla
   * deja de responder; sin ellos, no existe.
   */
  /*
   * El grafo se inhabilita mientras quede algo en conflicto — decisión 4. No es
   * solo «se ve atenuado»: `inert` saca referencias y tabla del alcance del
   * ratón, del teclado y del árbol de accesibilidad; el rol visual deshabilitado
   * comunica además dónde no se puede actuar. Con todo resuelto vuelven a
   * responder aunque la operación siga sin concluir.
   */
  const details = (
    <div
      className={[styles.details, centered ? styles.centered : ''].filter(Boolean).join(' ')}
      inert={writeBlocked}
    >
      {resolving && status !== null ? (
        <ConflictLists
          status={status}
          ours={operationSides.ours}
          theirs={
            standaloneConflict || stashRecovery !== undefined
              ? t('resolve.standalone.source')
              : operationSides.theirs
          }
          onMarkResolved={markConflictsResolved}
          onUnresolve={(paths) => {
            void unresolveConflicts(paths);
          }}
          onOpenResolved={openResolvedFile}
          {...(stashRecovery !== undefined
            ? {
                kind: 'stash' as const,
                operation: stashRecovery,
                onApply: actions.continueOperation,
              }
            : standaloneConflict
              ? { kind: 'standalone' as const }
              : {
                  kind: 'operation' as const,
                  operation: operation.kind as 'merge' | 'rebase' | 'cherryPick' | 'revert',
                  onApply: actions.continueOperation,
                })}
        />
      ) : fileHistory !== null ? (
        <FileHistoryPanel
          repoId={base.repoId}
          path={fileHistory.path}
          activeSha={fileHistory.at}
          openLatest={fileHistory.openLatest}
          menuFor={commitMenuFor}
          onOpenDiff={(sha) => {
            actions.openDiff(fileHistory.path, { kind: 'commit', sha });
          }}
          onClose={closeFileHistory}
        />
      ) : editingAmend && status?.clean && refs ? (
        <CommitComposer
          repoId={base.repoId}
          head={headBranch}
          headName={headName}
          headSha={refs.head.sha}
          stagedCount={0}
          commitPrecondition={status.commitPrecondition}
          actions={actions}
        />
      ) : editingAmend && status && refs ? (
        <StagingPanel
          repoId={base.repoId}
          status={status}
          head={headBranch}
          headName={headName}
          headSha={refs.head.sha}
          menuContext={menuContext}
          actions={actions}
        />
      ) : compare !== null ? (
        <ComparePanel
          repoId={base.repoId}
          compare={compare}
          status={status}
          menuContext={menuContext}
          onClose={closeCompare}
        />
      ) : selectedStash !== undefined ? (
        <CommitDetails
          repoId={base.repoId}
          sha={selectedStash.sha}
          sourceKind="stash"
          menuContext={menuContext}
          showChangeDetails={false}
          allowAllFiles={false}
        />
      ) : singleSelected !== undefined ? (
        <CommitDetails
          repoId={base.repoId}
          sha={singleSelected}
          menuContext={menuContext}
          canAmend={singleSelected === refs?.head.sha && operation.kind === 'none'}
        />
      ) : selectedCommits.size > 1 ? (
        <EmptyState
          size="sm"
          title={t('working.details.selected', { count: selectedCommits.size })}
          description={t(
            selectedCommits.size === 2
              ? 'working.details.selection.two'
              : 'working.details.selection.many',
          )}
        />
      ) : onlySelected === 'wip' && status && refs && !status.clean ? (
        <StagingPanel
          repoId={base.repoId}
          status={status}
          head={headBranch}
          headName={headName}
          headSha={refs.head.sha}
          menuContext={menuContext}
          actions={actions}
        />
      ) : (
        <EmptyState
          size="sm"
          title={t('working.details.title')}
          description={t('working.details.description')}
          actions={
            refs?.head.sha && operation.kind === 'none' ? (
              <Button onClick={() => useWorkingStore.getState().requestCommit(true)}>
                {t('working.composer.amend')}
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );

  return (
    <div
      className={styles.view}
      onPointerDownCapture={(event) => {
        if (diff === null) return;
        // Los menús del diff viven en un portal. React propaga su evento hasta
        // esta vista, pero el puntero no está sobre uno de sus paneles externos.
        // Cerrarlo aquí desmontaría el menú antes de ejecutar el clic.
        if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return;
        if (event.target instanceof Element && event.target.closest('[data-diff-viewer]')) return;
        if (event.target instanceof Element && event.target.closest('[data-file-history]')) return;

        closeDiff();
      }}
    >
      <SplitPane
        label={t('working.split.refsLabel')}
        storageId="working.split"
        defaultRatio={0.18}
        minFirst={200}
        minSecond={640}
        collapsible="first"
        collapsedSize="content"
        collapsed={refsCollapsed}
        onCollapsedChange={() => {
          gestures.run('working.toggleRefs');
        }}
        first={
          <div
            className={[styles.leftPane, blocked ? styles.blockedSurface : '']
              .filter(Boolean)
              .join(' ')}
            inert={blocked || writeBlocked}
          >
            {left}
          </div>
        }
        second={
          <SplitPane
            label={t('working.split.detailsLabel')}
            storageId="working.details"
            defaultRatio={0.72}
            minFirst={440}
            minSecond={280}
            collapsible="second"
            collapsedSize={0}
            collapsed={detailsCollapsed}
            onCollapsedChange={() => {
              gestures.run('working.toggleDetails');
            }}
            first={
              <div className={styles.centerPane}>
                <WorkingProgress />
                <div className={styles.centerContent} inert={writeBlocked}>
                  {openConflict !== null && resolveStep === 'resolved' ? (
                    <ResolvedResult
                      key={openConflict}
                      path={openConflict}
                      encoding={useResolveStore.getState().encodings.get(openConflict)}
                      result={drafts.get(openConflict) ?? ''}
                      origins={resolutionOrigins.get(openConflict) ?? []}
                      sources={
                        resolutionSources.get(openConflict) ?? {
                          ours: operationSides.ours,
                          theirs: operationSides.theirs,
                        }
                      }
                      onClose={closeConflictFile}
                    />
                  ) : (
                    center
                  )}
                </div>
              </div>
            }
            second={details}
          />
        }
      />

      {dialog !== null && refs !== null && (
        <WorkingDialogHost
          repoId={base.repoId}
          dialog={dialog}
          refs={refs}
          status={status}
          repository={loaded?.repository ?? null}
          actions={actions}
          onCancel={closeDialog}
        />
      )}

      {/*
       * El resolutor cubre la ventana entera —decisión 5 del subplan de
       * Resolver—, así que va aquí y no dentro de la columna central como el
       * visor de diff. Resolver un conflicto es una tarea de pantalla
       * completa; leer un diff, no.
       */}
      {openConflict !== null && resolveStep === 'resolver' && (
        <ThreeWayResolver
          repoId={base.repoId}
          path={openConflict}
          onFinish={async (text, origins, sources, revision, encoding) => {
            setDraft(openConflict, text, origins, sources);
            await writeResolution(openConflict, text, revision, encoding);
            if (encoding) useResolveStore.getState().setEncoding(openConflict, encoding);
          }}
          onKeepSide={(side) => {
            void keepSideOfOpenFile(openConflict, side);
          }}
          onCancel={closeConflictFile}
        />
      )}

      <ActionPreviewMount repoId={base.repoId} actions={actions} />

      {pushRejected !== null && (
        <PushRejectedPanel
          info={pushRejected}
          onPullAndRetry={() => {
            closePushRejected();
            actions.pullAndRetryPush();
          }}
          onForce={() => {
            closePushRejected();
            actions.push({ expectedRemoteTip: pushRejected.expectedRemoteTip });
          }}
          onCancel={closePushRejected}
        />
      )}
    </div>
  );
}

interface WorkingDialogHostProps {
  repoId: RepoId;
  dialog: WorkingDialog;
  refs: RefsSnapshot;
  status: WorkingStatus | null;
  repository: Repository | null;
  actions: ReturnType<typeof useWorkingActions>;
  onCancel: () => void;
}

/**
 * Qué diálogo toca, según lo que se pidió.
 *
 * Aparte de `WorkingView` para que la vista no crezca con once ramas de un
 * `switch` en medio del reparto de paneles. Es un despachador, no una pieza con
 * lógica propia: cada diálogo se sigue explicando solo.
 */
function WorkingDialogHost({
  repoId,
  dialog,
  refs,
  status,
  repository,
  actions,
  onCancel,
}: WorkingDialogHostProps) {
  const { t } = useI18n();

  const busy = useWorkingStore((state) => state.pendingWrites > 0);
  const branchNames = refs.branches.map((branch) => branch.name);
  const tagNames = refs.tags.map((tag) => tag.name);
  const head = refs.head.branch ?? shortSha(refs.head.sha);

  switch (dialog.kind) {
    case 'createBranch':
      return (
        <BranchNameDialog
          mode={{ kind: 'create', from: dialog.from, fromLabel: dialog.fromLabel }}
          taken={branchNames}
          onCreate={actions.confirmCreateBranch}
          onRename={() => undefined}
          onCancel={onCancel}
        />
      );

    case 'recoverHistory':
      return (
        <RecoveryDialog
          repoId={repoId}
          taken={branchNames}
          onConfirm={actions.confirmRecoverHistory}
          onCancel={onCancel}
        />
      );

    case 'renameBranch':
      return (
        <BranchNameDialog
          mode={{ kind: 'rename', branch: dialog.branch }}
          taken={branchNames}
          onCreate={actions.confirmCreateBranch}
          onRename={(from, to) => {
            actions.confirmRenameBranch(from, to, dialog.expectedTip);
          }}
          onCancel={onCancel}
        />
      );

    case 'createTag':
      return (
        <TagNameDialog
          at={dialog.at}
          atLabel={dialog.atLabel}
          taken={tagNames}
          onConfirm={actions.confirmCreateTag}
          onCancel={onCancel}
        />
      );

    case 'createWorktree':
      return repository === null ? null : (
        <WorktreeDialog
          repoName={repository.name}
          repoPath={repository.path}
          branches={refs.branches}
          initialBranch={dialog.branch}
          onConfirm={actions.confirmCreateWorktree}
          onCancel={onCancel}
        />
      );

    case 'deleteBranch':
      return (
        <ConfirmDialog
          title={t('working.dialog.deleteBranch.title', { branch: dialog.branch })}
          description={t('working.dialog.deleteBranch.description', { branch: dialog.branch })}
          confirmLabel={t('working.dialog.deleteBranch.confirm', { branch: dialog.branch })}
          onConfirm={() => {
            actions.confirmDeleteBranch(dialog.branch, dialog.expectedTip);
          }}
          onCancel={onCancel}
        />
      );

    case 'deleteTag':
      return (
        <ConfirmDialog
          title={t('working.dialog.deleteTag.title', { tag: dialog.tag })}
          description={t('working.dialog.deleteTag.description', { tag: dialog.tag })}
          confirmLabel={t('working.dialog.deleteTag.confirm', { tag: dialog.tag })}
          onConfirm={() => {
            actions.confirmDeleteTag(dialog.tag, dialog.expectedTip);
          }}
          onCancel={onCancel}
        >
          {/* Borrarlo también en el remoto es un push de borrado, y Push es
              F2.9: la casilla se pinta deshabilitada para que la fase que lo
              traiga no tenga que rehacer el hueco. */}
          <Checkbox
            label={t('working.dialog.deleteTag.alsoRemote', {
              remote: refs.remotes[0]?.name ?? t('working.menu.noRemote'),
            })}
            checked={false}
            disabled
            readOnly
          />
        </ConfirmDialog>
      );

    case 'publishBranch':
      return (
        <PublishBranchDialog
          branch={dialog.branch}
          remotes={dialog.remotes}
          onConfirm={(remote) => {
            onCancel();
            actions.push({ remote, setUpstream: true });
          }}
          onCancel={onCancel}
        />
      );

    case 'remote':
      return (
        <RemoteDialog
          {...(dialog.remote === undefined ? {} : { remote: dialog.remote })}
          taken={refs.remotes.map((remote) => remote.name)}
          onConfirm={actions.confirmSaveRemote}
          onCancel={onCancel}
        />
      );

    case 'remoteCredentials':
      return <RemoteCredentialsDialog repoId={repoId} remote={dialog.remote} onCancel={onCancel} />;

    case 'removeRemote':
      return (
        <ConfirmDialog
          title={t('working.dialog.remote.removeTitle', { remote: dialog.remote.name })}
          description={t('working.dialog.remote.removeDescription', {
            remote: dialog.remote.name,
          })}
          confirmLabel={t('working.dialog.remote.removeConfirm', { remote: dialog.remote.name })}
          onConfirm={() => {
            actions.confirmRemoveRemote(dialog.remote);
          }}
          onCancel={onCancel}
        />
      );

    case 'removeWorktree':
      return (
        <ConfirmDialog
          title={t('working.dialog.removeWorktree.title', { worktree: dialog.name })}
          description={t('working.dialog.removeWorktree.description', { path: dialog.path })}
          confirmLabel={t('working.dialog.removeWorktree.confirm', { worktree: dialog.name })}
          onConfirm={() => {
            const worktree = refs.worktrees.find((candidate) => candidate.path === dialog.path);

            if (worktree) actions.confirmRemoveWorktree(worktree);
          }}
          onCancel={onCancel}
        />
      );

    case 'cherryPick':
      return (
        <CommitSequenceDialog
          kind="cherryPick"
          repoId={repoId}
          branch={head}
          shas={dialog.shas}
          contiguous={dialog.contiguous}
          precondition={dialog.precondition}
          onConfirm={actions.confirmCherryPick}
          onCancel={onCancel}
        />
      );

    case 'revert':
      return (
        <CommitSequenceDialog
          kind="revert"
          repoId={repoId}
          branch={head}
          shas={dialog.shas}
          contiguous={dialog.contiguous}
          precondition={dialog.precondition}
          onConfirm={actions.confirmRevert}
          onCancel={onCancel}
        />
      );

    case 'reset':
      return (
        <ResetDialog
          branch={head}
          sha={dialog.sha}
          initialMode={dialog.mode}
          busy={busy}
          dirtyFiles={status === null ? 0 : status.staged.length + status.unstaged.length}
          onConfirm={(sha, mode) =>
            actions.confirmReset(sha, mode, dialog.expectedBranch, dialog.precondition)
          }
          onCancel={onCancel}
        />
      );

    case 'discardAll':
      return (
        <ConfirmDialog
          title={t('working.staging.discardAll')}
          description={t('working.dialog.discardAll.description', { count: dialog.count })}
          confirmLabel={t('working.staging.discardAll')}
          busy={busy}
          onConfirm={() => actions.confirmDiscardAll(dialog.precondition)}
          onCancel={onCancel}
        />
      );

    case 'discard': {
      const paths = dialog.targets.map((target) => target.path);
      return (
        <ConfirmDialog
          title={t('working.dialog.discard.title', { count: paths.length })}
          description={t('working.dialog.discard.description', {
            files: paths.join(', '),
          })}
          confirmLabel={t('working.dialog.discard.confirm', { count: paths.length })}
          onConfirm={() => {
            actions.confirmDiscard(dialog.targets);
          }}
          onCancel={onCancel}
        />
      );
    }

    case 'discardLines':
      return (
        <ConfirmDialog
          title={t('working.dialog.discardLines.title', {
            count: dialog.request.lines?.length ?? 0,
            path: dialog.request.path,
          })}
          description={t('working.dialog.discardLines.description', { path: dialog.request.path })}
          confirmLabel={t('working.dialog.discardLines.confirm', {
            count: dialog.request.lines?.length ?? 0,
          })}
          onConfirm={() => {
            actions.confirmDiscardLines(dialog.request);
          }}
          onCancel={onCancel}
        />
      );

    case 'stash':
      return <StashDialog branch={dialog.branch} onConfirm={actions.stash} onCancel={onCancel} />;

    case 'dropStash':
      return (
        <ConfirmDialog
          title={t('working.dialog.dropStash.title', { stash: stashName(dialog.stash) })}
          description={t('working.dialog.dropStash.description', { index: dialog.stash.index })}
          confirmLabel={t('working.dialog.dropStash.confirm', { stash: stashName(dialog.stash) })}
          onConfirm={() => {
            actions.confirmDropStash(dialog.stash);
          }}
          onCancel={onCancel}
        />
      );

    case 'remoteBranchAhead':
      return (
        <RemoteBranchAheadDialog
          local={dialog.local}
          remote={dialog.remote}
          onReset={() => {
            actions.confirmResetRemoteBranch(dialog.local, dialog.remote);
          }}
          onCreateBranch={actions.createBranch}
          onCancel={onCancel}
        />
      );
  }
}

/**
 * Monta `ActionPreview` condicionalmente, sin que `WorkingView` se suscriba al
 * estado de la vista previa — F2.7.
 */
function ActionPreviewMount({
  repoId,
  actions,
}: {
  repoId: string;
  actions: ReturnType<typeof useWorkingActions>;
}) {
  const state = useWorkingStore((s) => s.actionPreview);

  if (state === null) return null;

  return (
    <ActionPreview
      state={state}
      repoId={repoId}
      onMerge={actions.confirmMerge}
      onRebase={actions.confirmRebase}
    />
  );
}
