import { useEffect, useMemo, useRef } from 'react';

import { usePorts } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import type { CommitRequest, CommitSequencePrecondition, Sha } from '@core/domain/commit';
import { shortSha } from '@core/domain/commit';
import type { DiffPrecondition, DiffSource } from '@core/domain/diff';
import {
  describeError,
  isCancelled,
  isGitOperationError,
  toGitOperationError,
} from '@core/domain/errors';
import type {
  Branch,
  IntegrationPrecondition,
  RefsSnapshot,
  RefTarget,
  Remote,
  ResetMode,
  Stash,
  Worktree,
} from '@core/domain/refs';
import type { RepoId, Repository, TransferProgress, UndoEntry } from '@core/domain/repository';
import { stashName } from '@core/domain/refs';
import type { ReflogEntry } from '@core/domain/repository';
import type { ResetPrecondition, WorkingStatus } from '@core/domain/status';
import type { DiscardTarget, LineRef, PartialWriteRequest } from '@core/ports/GitPort';

import type { WorkingMenuActions } from './contextMenus';
import type { GraphNodeForm } from './graphPaint';
import { useWorkingStore } from './workingStore';

/**
 * Hacia dónde va el stage parcial.
 *
 * Un booleano diría «preparado: sí» y habría que recordar si eso es el estado
 * de antes o el de después; con dos palabras, el sitio donde se lee dice cuál
 * de las dos escrituras se pidió.
 */
export type StageDirection = 'stage' | 'unstage';

/**
 * Lo que los diálogos confirman, además de lo que los menús disparan.
 *
 * Un menú **pide** —«Borrar `dev`»— y un diálogo **confirma** —«Borrar `dev`,
 * que tiene 3 commits sin fusionar»—. Por eso las dos mitades viven en el mismo
 * objeto pero con nombres distintos: `deleteBranch` abre el diálogo y
 * `confirmDeleteBranch` es la que escribe.
 */
export interface WorkingActions extends WorkingMenuActions {
  /** Activa una rama remota desde el grafo sin dejar HEAD desacoplado. */
  activateRemoteBranch: (remote: Branch, local?: Branch) => void;
  /** Confirma reemplazar la punta local por la remota y cambiarse a ella. */
  confirmResetRemoteBranch: (local: Branch, remote: Branch) => void;
  confirmCreateBranch: (name: string, from: RefTarget, checkout: boolean) => void;
  confirmRecoverHistory: (name: string, entry: ReflogEntry) => void;
  confirmRenameBranch: (from: string, to: string, expectedTip: Sha) => void;
  confirmDeleteBranch: (branch: string, expectedTip: Sha) => void;
  confirmCreateTag: (name: string, at: RefTarget, message: string) => void;
  confirmDeleteTag: (tag: string, expectedTip: Sha) => void;
  confirmCreateWorktree: (path: string, branch: RefTarget) => void;
  confirmRemoveWorktree: (worktree: Worktree) => void;
  confirmSaveRemote: (remote: Remote, previous?: Remote) => void;
  confirmRemoveRemote: (remote: Remote) => void;
  confirmCherryPick: (
    shas: readonly Sha[],
    precondition: CommitSequencePrecondition,
    mainline?: number,
  ) => void;
  confirmRevert: (
    shas: readonly Sha[],
    precondition: CommitSequencePrecondition,
    mainline?: number,
  ) => void;
  confirmReset: (
    sha: Sha,
    mode: ResetMode,
    expectedBranch: string,
    precondition: ResetPrecondition,
  ) => void;
  confirmDiscardAll: (precondition: ResetPrecondition) => void;
  confirmDiscard: (targets: readonly DiscardTarget[]) => void;
  confirmDiscardLines: (request: PartialWriteRequest) => void;
  /** Escribe el commit con lo que el compositor tenga puesto — CU-7. */
  commit: (request: CommitRequest, branch: string) => void;
  /** Prepara o retira un hunk entero — CU-5, solo con origen editable. */
  stageHunk: (
    path: string,
    hunkId: string,
    direction: StageDirection,
    precondition: DiffPrecondition,
    ignoreWhitespace: boolean,
  ) => void;
  /** Prepara o retira las líneas marcadas dentro de un hunk — CU-5. */
  stageLines: (
    path: string,
    lines: readonly LineRef[],
    direction: StageDirection,
    precondition: DiffPrecondition,
    ignoreWhitespace: boolean,
  ) => void;
  /** Descarta líneas del árbol de trabajo — solo con origen editable, nunca del índice. */
  discardLines: (
    path: string,
    lines: readonly LineRef[],
    precondition: DiffPrecondition,
    ignoreWhitespace: boolean,
  ) => void;
  /** Fusiona `source` dentro de la rama activa — F2.8. */
  confirmMerge: (source: string, target: string, precondition: IntegrationPrecondition) => void;
  /** Rebasa la rama activa sobre `source` — F2.8. */
  confirmRebase: (source: string, target: string, precondition: IntegrationPrecondition) => void;
  /** Guarda los cambios en un stash con mensaje automático — F2.8+. */
  stash: (message: string, includeUntracked: boolean, paths?: readonly string[]) => void;
  /** Guarda solo los archivos indicados en un stash selectivo. */
  stashPaths: (paths: readonly string[]) => void;
  /** Cambia el mensaje de un guardado ya existente — edición inline. */
  renameStash: (stash: Stash, message: string) => void;
  /** Aplica el guardado en `index` y opcionalmente lo borra — F2.8. */
  pop: (stash: Stash, drop: boolean) => void;
  dropStash: (stash: Stash) => void;
  confirmDropStash: (stash: Stash) => void;
  /** Deshace la última operación de git — F2.8. */
  undo: () => void;
  /** Rehace la última operación deshecha — F2.8. */
  redo: () => void;
  /** Continúa una operación a medias — F2.8. */
  continueOperation: () => void;
  /** Aborta una operación a medias — F2.8. */
  abortOperation: () => void;
  /** Trae de todos los remotos o de uno específico — F2.9. */
  fetch: (remote?: string) => void;
  /** Pull con la estrategia que decide el puerto — F2.9. */
  pull: (strategy?: 'auto' | 'rebase' | 'merge') => void;
  /** Push de la rama activa — F2.9. */
  push: (options?: { expectedRemoteTip?: Sha; remote?: string; setUpstream?: boolean }) => void;
  /** Cancela el fetch nativo que está transfiriendo objetos. */
  cancelNetwork: () => void;
  /** Trae y luego reintenta la publicación — F2.9, panel de push rechazado. */
  pullAndRetryPush: () => void;
}

export interface WorkingActionsOptions {
  repoId: RepoId;
  repoPath: string;
  /** Toda escritura devuelve el estado que cambió; esto es quien lo recoge. */
  applyRepository: (repository: Repository) => void;
  applyRefs: (refs: RefsSnapshot) => void;
  applyStatus: (status: WorkingStatus) => void;
  applyUndoStack: (stack: { undo: readonly UndoEntry[]; redo: readonly UndoEntry[] }) => void;
  /** El plegado de las cinco secciones, que solo `RefPanel` sabe mover. */
  setAllSectionsCollapsed: (collapsed: boolean) => void;
  setNodeForm: (form: GraphNodeForm) => void;
  setWipName?: (name: string | null) => void;
}

/**
 * Todo lo que GitWorking le pide a los puertos desde sus menús y diálogos.
 *
 * Vive aparte de los componentes por lo mismo que `useRepositoryActions`: aquí
 * es donde se conocen los puertos y donde vive el **orden** de las escrituras.
 * Y por lo mismo, ninguna acción se suscribe al store: leen con `getState()`,
 * así que el objeto que devuelve el gancho es estable y un menú no se
 * reconstruye porque alguien haya cambiado de selección.
 *
 * **Ninguna escritura relee el repositorio entero.** `GitPort` promete devolver
 * el estado que cambió —`RefsSnapshot` o `WorkingStatus`—, así que lo que se
 * hace con el resultado es aplicarlo encima de lo que la vista ya tenía. Releer
 * detrás de cada escritura dejaría la pantalla en esqueleto por haber renombrado
 * una rama.
 */
export function useWorkingActions(options: WorkingActionsOptions): WorkingActions {
  const { git, system } = usePorts();
  const {
    repoId,
    repoPath,
    applyRepository,
    applyRefs,
    applyStatus,
    applyUndoStack,
    setAllSectionsCollapsed,
  } = options;
  const { setNodeForm, setWipName: persistWipName } = options;
  const networkAbort = useRef<AbortController | null>(null);
  const recoveryPending = useRef(false);

  useEffect(
    () => () => {
      networkAbort.current?.abort();
    },
    [repoId],
  );

  return useMemo<WorkingActions>(() => {
    const shell = () => useShellStore.getState();
    const store = () => useWorkingStore.getState();
    const setWipName =
      persistWipName ??
      ((name: string | null) => {
        useWorkingStore.getState().setWipName(name);
      });

    /**
     * Un fallo de git llega a la barra inferior como clave, no como frase.
     *
     * `describeError` ya traduce el código a la clave de su título, así que
     * cambiar de idioma retraduce también el aviso que quedó escrito — la regla
     * de que ningún estado guarda texto ya traducido.
     */
    const report = (error: unknown) => {
      if (isCancelled(error)) return;

      const gitError = toGitOperationError(error);
      const described = describeError(gitError);
      const stash = store().context?.stashes?.find(
        (entry) => described.params.stash === `stash@{${String(entry.index)}}`,
      );

      shell().setStatus({
        tone: 'danger',
        key: described.titleKey,
        params: stash ? { ...described.params, stash: stashName(stash) } : described.params,
      });
    };

    /** Encadena una escritura y deja el resultado puesto, o cuenta el fallo. */
    const write = (run: () => Promise<void>) => {
      useWorkingStore.setState((state) => ({ pendingWrites: state.pendingWrites + 1 }));
      void run()
        .then(async () => {
          applyUndoStack(await git.readUndoStack(repoId));
        })
        .catch(async (error: unknown) => {
          if (
            isGitOperationError(error) &&
            (error.code === 'stash.autoConflict' || error.code === 'checkout.restoreFailed')
          ) {
            await refreshOperationState();
            store().bumpHistory();
          }
          report(error);
          // A multi-file write may have succeeded partly; expose its recovery step too.
          try {
            applyUndoStack(await git.readUndoStack(repoId));
          } catch {
            // Keep the original operation error visible if refreshing also fails.
          }
        })
        .finally(() => {
          useWorkingStore.setState((state) => ({
            pendingWrites: Math.max(0, state.pendingWrites - 1),
          }));
        });
    };

    const refreshOperationState = async () => {
      const refreshed = await Promise.allSettled([
        git.readRepository(repoId),
        git.readRefs(repoId),
        git.readStatus(repoId),
      ]);
      if (refreshed[0].status === 'fulfilled') applyRepository(refreshed[0].value);
      if (refreshed[1].status === 'fulfilled') applyRefs(refreshed[1].value);
      if (refreshed[2].status === 'fulfilled') applyStatus(refreshed[2].value);
    };

    // A rejected integration can still have updated HEAD and started stash recovery.
    // The write wrapper refreshes that transition before reporting the original error.
    const closeOperation = async (run: () => Promise<Repository>) => {
      try {
        applyRepository(await run());
        const [refs, status] = await Promise.all([git.readRefs(repoId), git.readStatus(repoId)]);
        applyRefs(refs);
        applyStatus(status);
      } finally {
        store().bumpHistory();
      }
    };

    const recover = (run: () => Promise<void>) => {
      if (recoveryPending.current) return;
      recoveryPending.current = true;
      void run()
        .catch(report)
        .finally(() => {
          recoveryPending.current = false;
        });
    };

    const closeDialog = () => {
      store().closeDialog();
    };

    /**
     * El visor sigue al archivo que acaba de cambiar de lista.
     *
     * Con el archivo abierto desde Seguimiento, pasarlo entero al stage deja su
     * diff contra el índice vacío: lo que cambió ya está preparado. Reapuntar el
     * visor al otro origen enseña exactamente lo mismo que se estaba leyendo, en
     * el lado donde ahora vive. Solo aplica al archivo entero — preparar un hunk
     * suelto deja el resto sin preparar, y ahí el visor se queda donde está.
     */
    const followDiff = (paths: readonly string[], source: DiffSource) => {
      const open = store().diff;

      if (!open || open.source.kind === source.kind || !paths.includes(open.path)) return;
      if (open.source.kind !== 'worktree' && open.source.kind !== 'index') return;

      store().openDiff({ path: open.path, source });
    };

    const discardTargets = async (paths: readonly string[]): Promise<readonly DiscardTarget[]> =>
      Promise.all(
        paths.map(async (path) => {
          const file = await git.readDiff(repoId, { path, source: { kind: 'worktree' } });
          return { path, precondition: file.precondition };
        }),
      );

    const startNetwork = (
      returnFocusTo: 'working.fetch' | 'working.pull' | 'working.push',
      run: (
        controller: AbortController,
        onProgress: (progress: TransferProgress) => void,
      ) => Promise<void>,
      onSuccess: () => void,
    ) => {
      if (networkAbort.current !== null) return;

      const controller = new AbortController();
      networkAbort.current = controller;
      store().setNetworkBusy(true);
      store().setNetworkProgress({ phase: 'counting', received: 0, total: null });
      write(async () => {
        try {
          await run(controller, (progress) => {
            if (networkAbort.current === controller) store().setNetworkProgress(progress);
          });
        } finally {
          // Una respuesta local puede terminar en el mismo lote de React que
          // montó la franja. Conservarla un cuadro garantiza la señal visible
          // y permite que GitActionBar capture el control al que devolver foco.
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
          if (networkAbort.current === controller) {
            networkAbort.current = null;
            store().setNetworkBusy(false);
            store().setNetworkProgress(null);
            store().requestNetworkFocus(returnFocusTo);
          }
        }
        onSuccess();
      });
    };

    const startFetch = (remote?: string) => {
      startNetwork(
        'working.fetch',
        async (controller, onProgress) => {
          applyRefs(
            await git.fetch(repoId, remote ?? null, { onProgress }, { signal: controller.signal }),
          );
        },
        () => {
          shell().setStatus({
            tone: 'success',
            key: remote ? 'working.status.fetched' : 'working.status.fetchedAll',
            params: remote ? { remote } : {},
          });
        },
      );
    };

    return {
      checkout: (target, label) => {
        write(async () => {
          applyRefs(await git.checkout(repoId, target, { autoStash: true }));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.switched',
            params: { branch: label },
          });
        });
      },

      activateRemoteBranch: (remote, local) => {
        const remoteName = remote.remote ?? remote.name.split('/')[0] ?? '';
        const target: RefTarget = {
          kind: 'remoteBranch',
          name: remote.name,
          remote: remoteName,
        };
        const localName = remote.name.startsWith(`${remoteName}/`)
          ? remote.name.slice(remoteName.length + 1)
          : remote.name;

        if (
          local &&
          local.tip !== remote.tip &&
          (local.upstreamMissing || local.ahead > 0 || local.behind === 0)
        ) {
          store().openDialog({ kind: 'remoteBranchAhead', local, remote });
          return;
        }

        write(async () => {
          applyRefs(
            await git.checkout(repoId, target, {
              autoStash: true,
              remoteMode: 'fastForward',
              ...(local === undefined ? {} : { expectedLocalTip: local.tip }),
              expectedRemoteTip: remote.tip,
            }),
          );
          shell().setStatus({
            tone: 'success',
            key: 'working.status.switched',
            params: { branch: local?.name ?? localName },
          });
        });
      },

      confirmResetRemoteBranch: (local, remote) => {
        closeDialog();
        const remoteName = remote.remote ?? remote.name.split('/')[0] ?? '';
        write(async () => {
          applyRefs(
            await git.checkout(
              repoId,
              { kind: 'remoteBranch', name: remote.name, remote: remoteName },
              {
                autoStash: true,
                remoteMode: 'reset',
                expectedLocalTip: local.tip,
                expectedRemoteTip: remote.tip,
              },
            ),
          );
          shell().setStatus({
            tone: 'success',
            key: 'working.status.switched',
            params: { branch: local.name },
          });
        });
      },

      createBranch: (from, fromLabel) => {
        store().openDialog({ kind: 'createBranch', from, fromLabel });
      },

      renameBranch: (branch, expectedTip) => {
        store().openDialog({ kind: 'renameBranch', branch, expectedTip });
      },

      deleteBranch: (branch, expectedTip) => {
        store().openDialog({ kind: 'deleteBranch', branch, expectedTip });
      },

      createTag: (at, atLabel) => {
        store().openDialog({ kind: 'createTag', at, atLabel });
      },

      deleteTag: (tag, expectedTip) => {
        store().openDialog({ kind: 'deleteTag', tag, expectedTip });
      },

      createWorktree: (branch) => {
        store().openDialog({ kind: 'createWorktree', branch });
      },

      removeWorktree: (worktree) => {
        store().openDialog({
          kind: 'removeWorktree',
          path: worktree.path,
          name: worktree.name,
        });
      },

      openWorktree: (worktree) => {
        write(async () => {
          const known = await git.listRepositories();
          const summary =
            known.find((repo) => repo.path === worktree.path) ??
            (await git.openRepository(worktree.path));

          shell().openWorking({
            repoId: summary.id,
            repoName: summary.name,
            repoPath: summary.path,
            branch: summary.head,
            ...(summary.worktreeOf === undefined ? {} : { worktreeOf: summary.worktreeOf }),
          });
        });
      },

      lockWorktree: (worktree, locked) => {
        write(async () => {
          applyRefs(await git.lockWorktree(repoId, worktree.path, locked));
          shell().setStatus({
            tone: 'success',
            key: locked ? 'working.status.worktreeLocked' : 'working.status.worktreeUnlocked',
            params: { worktree: worktree.name },
          });
        });
      },

      fetchRemote: (remote) => {
        startFetch(remote);
      },

      addRemote: () => {
        store().openDialog({ kind: 'remote' });
      },

      editRemote: (remote) => {
        store().openDialog({ kind: 'remote', remote });
      },

      manageRemoteCredentials: (remote) => {
        store().openDialog({ kind: 'remoteCredentials', remote });
      },

      removeRemote: (remote) => {
        store().openDialog({ kind: 'removeRemote', remote });
      },

      cherryPick: (shas, contiguous) => {
        const context = store().context;
        if (context?.headBranch === null || context === null) return;
        store().openDialog({
          kind: 'cherryPick',
          shas,
          contiguous,
          precondition: { targetRef: context.headBranch, targetOid: context.headSha },
        });
      },

      revert: (shas, contiguous) => {
        const context = store().context;
        if (context?.headBranch === null || context === null) return;
        store().openDialog({
          kind: 'revert',
          shas,
          contiguous,
          precondition: { targetRef: context.headBranch, targetOid: context.headSha },
        });
      },

      reset: (sha, mode) => {
        const context = store().context;
        if (context?.headBranch === null || context === null) return;
        store().openDialog({
          kind: 'reset',
          sha,
          mode,
          expectedBranch: context.headBranch,
          precondition: context.resetPrecondition,
        });
      },

      stage: (paths) => {
        write(async () => {
          applyStatus(await git.stage(repoId, paths));
          applyUndoStack(await git.readUndoStack(repoId));
          followDiff(paths, { kind: 'index' });
        });
      },

      unstage: (paths) => {
        write(async () => {
          applyStatus(await git.unstage(repoId, paths));
          applyUndoStack(await git.readUndoStack(repoId));
          followDiff(paths, { kind: 'worktree' });
        });
      },

      // El descarte conserva una copia recuperable durante la sesión y requiere confirmación.
      discard: (paths) => {
        write(async () => {
          store().openDialog({ kind: 'discard', targets: await discardTargets(paths) });
        });
      },

      // Comparar es lectura pura: no escribe nada, así que no pasa por `write`
      // ni por un diálogo. Lo único que hace es cambiar de qué habla el panel
      // derecho, y quien lee de verdad es `ComparePanel`, que se cancela solo al
      // cambiar de comparación.
      compare: (source, target) => {
        store().openCompare({ kind: 'refs', source, target });
      },

      previewIntegration: (kind, source, target) => {
        store().openActionPreview({
          kind,
          source: { kind: 'branch', name: source },
          target: { kind: 'branch', name: target },
          headBranch: target,
        });
      },

      ignorePath: (pattern, untrack) => {
        write(async () => {
          applyStatus(await git.ignorePath(repoId, pattern, { untrack }));
          shell().setStatus({
            tone: 'success',
            key: untrack ? 'working.status.ignoredAndUntracked' : 'working.status.ignored',
            params: { pattern },
          });
        });
      },

      viewFileHistory: (path, at) => {
        store().openFileHistory(path, at);
      },

      // Abrir el visor es lectura pura, como comparar: lo único que cambia es
      // qué está enseñando la columna central, y quien lee de verdad es
      // `DiffViewer`, que se cancela solo al cambiar de archivo o de origen.
      openDiff: (path, source) => {
        store().openDiff({ path, source });
      },

      reveal: (path) => {
        const folder = revealFolderPath(repoPath, path);
        void system.revealPath(folder).catch(() => {
          // No poder abrir el explorador no rompe nada de lo que se estaba
          // haciendo: se cuenta abajo y ya.
          shell().setStatus({
            tone: 'warning',
            key: 'working.status.revealFailed',
            params: { path: folder },
          });
        });
      },

      copy: (text) => {
        void copyText(text).then(
          () => {
            shell().setStatus({ tone: 'success', key: 'working.status.copied' });
          },
          () => {
            shell().setStatus({ tone: 'warning', key: 'working.status.copyFailed' });
          },
        );
      },

      goToNode: (sha) => {
        store().requestGoTo(sha);
      },

      setNodeForm,
      setAllSectionsCollapsed,

      confirmCreateBranch: (name, from, checkout) => {
        closeDialog();
        write(async () => {
          applyRefs(await git.createBranch(repoId, name, from, { checkout }));
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.branchCreated',
            params: { branch: name },
          });
        });
      },

      confirmRecoverHistory: (name, entry) => {
        closeDialog();
        write(async () => {
          applyRefs(await git.recoverReflogEntry(repoId, name, entry.selector, entry.sha));
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.historyRecovered',
            params: { branch: name },
          });
        });
      },

      confirmRenameBranch: (from, to, expectedTip) => {
        closeDialog();
        write(async () => {
          applyRefs(await git.renameBranch(repoId, from, to, { expectedTip }));
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.branchRenamed',
            params: { from, to },
          });
        });
      },

      confirmSaveRemote: (remote, previous) => {
        closeDialog();
        write(async () => {
          const refs = previous
            ? await git.updateRemote(repoId, previous.name, remote, {
                fetchUrl: previous.fetchUrl,
                pushUrl: previous.pushUrl,
              })
            : await git.addRemote(repoId, remote);
          applyRefs(refs);
          shell().setStatus({
            tone: 'success',
            key: previous ? 'working.status.remoteUpdated' : 'working.status.remoteAdded',
            params: { remote: remote.name },
          });
        });
      },

      confirmRemoveRemote: (remote) => {
        closeDialog();
        write(async () => {
          applyRefs(
            await git.removeRemote(repoId, remote.name, {
              fetchUrl: remote.fetchUrl,
              pushUrl: remote.pushUrl,
            }),
          );
          shell().setStatus({
            tone: 'success',
            key: 'working.status.remoteRemoved',
            params: { remote: remote.name },
          });
        });
      },

      confirmDeleteBranch: (branch, expectedTip) => {
        closeDialog();
        write(async () => {
          applyRefs(await git.deleteBranch(repoId, branch, { force: true, expectedTip }));
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.branchDeleted',
            params: { branch },
          });
        });
      },

      confirmCreateTag: (name, at, message) => {
        closeDialog();
        write(async () => {
          // Mensaje vacío es tag ligero, con texto es anotado — CU-9, y por eso
          // el diálogo es el mismo para los dos.
          const options = message.trim() === '' ? {} : { message: message.trim() };

          applyRefs(await git.createTag(repoId, name, at, options));
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.tagCreated',
            params: { tag: name },
          });
        });
      },

      confirmDeleteTag: (tag, expectedTip) => {
        closeDialog();
        write(async () => {
          applyRefs(await git.deleteTag(repoId, tag, { expectedTip }));
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.tagDeleted',
            params: { tag },
          });
        });
      },

      confirmCreateWorktree: (path, branch) => {
        closeDialog();
        write(async () => {
          const created = await git.createWorktree(repoId, path, branch);

          // `createWorktree` devuelve la ficha del repositorio nuevo, no las
          // referencias: la sección Worktrees se relee aparte para que la fila
          // aparezca sin recargar la vista entera.
          applyRefs(await git.readRefs(repoId));
          shell().openWorking({
            repoId: created.id,
            repoName: created.name,
            repoPath: created.path,
            branch: created.head,
            ...(created.worktreeOf === undefined ? {} : { worktreeOf: created.worktreeOf }),
          });
          shell().setStatus({
            tone: 'success',
            key: 'working.status.worktreeCreated',
            params: { worktree: created.name, path: created.path },
          });
        });
      },

      confirmRemoveWorktree: (worktree) => {
        closeDialog();
        write(async () => {
          applyRefs(await git.removeWorktree(repoId, worktree.path));
          const removedTabs = shell().tabs.filter(
            (tab) => tab.surface.kind === 'working' && tab.surface.repoPath === worktree.path,
          );
          shell().closeTabs(new Set(removedTabs.map((tab) => tab.id)));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.worktreeRemoved',
            params: { worktree: worktree.name },
          });
        });
      },

      confirmCherryPick: (shas, precondition, mainline) => {
        closeDialog();
        write(async () => {
          await git.cherryPick(repoId, shas, {
            precondition,
            ...(mainline === undefined ? {} : { mainline }),
          });
          applyRefs(await git.readRefs(repoId));
          store().bumpHistory();
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.cherryPicked',
            params: { count: shas.length },
          });
        });
      },

      confirmRevert: (shas, precondition, mainline) => {
        closeDialog();
        write(async () => {
          await git.revert(repoId, shas, {
            precondition,
            ...(mainline === undefined ? {} : { mainline }),
          });
          applyRefs(await git.readRefs(repoId));
          store().bumpHistory();
          shell().setStatus({
            tone: 'success',
            key: 'working.status.reverted',
            params: { count: shas.length },
          });
        });
      },

      confirmReset: (sha, mode, expectedBranch, precondition) => {
        if (store().pendingWrites > 0) return;
        write(async () => {
          await git.reset(repoId, sha, mode, { expectedBranch, precondition });
          const [refs, status] = await Promise.all([git.readRefs(repoId), git.readStatus(repoId)]);
          applyRefs(refs);
          applyStatus(status);
          closeDialog();
          store().bumpHistory();
          shell().setStatus({
            tone: 'success',
            key:
              mode === 'soft'
                ? 'working.status.resetSoft'
                : mode === 'mixed'
                  ? 'working.status.resetMixed'
                  : 'working.status.resetHard',
            params: { sha },
          });
        });
      },

      confirmDiscardAll: (precondition) => {
        if (store().pendingWrites > 0) return;
        write(async () => {
          applyStatus(await git.discardAll(repoId, precondition));
          store().closeDiff();
          store().setFileSelection(null);
          closeDialog();
          shell().setStatus({ tone: 'success', key: 'working.status.discardedAll' });
        });
      },

      confirmDiscard: (targets) => {
        closeDialog();
        write(async () => {
          applyStatus(await git.discard(repoId, targets));
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.discarded',
            params: { count: targets.length },
          });
        });
      },

      confirmDiscardLines: (request) => {
        closeDialog();
        write(async () => {
          applyStatus(await git.discardLines(repoId, request));
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.linesDiscarded',
            params: { count: request.lines?.length ?? 0, path: request.path },
          });
        });
      },

      /*
       * El commit es la única escritura de la vista que cambia las tres cosas a
       * la vez: el árbol de trabajo se vacía, la rama se mueve y el historial
       * gana una fila. Por eso relee estado y referencias —`commit` solo
       * devuelve el SHA nuevo— y avisa a la tabla de que vuelva a paginar.
       */
      commit: (request, branch) => {
        write(async () => {
          const sha = await git.commit(repoId, request);

          store().clearCommitDraft();
          applyStatus(await git.readStatus(repoId));
          applyRefs(await git.readRefs(repoId));
          store().bumpHistory();
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: request.amend === true ? 'working.status.amended' : 'working.status.committed',
            params: { branch, sha: shortSha(sha) },
          });
        });
      },

      /*
       * El stage parcial no relee el diff, y no hace falta.
       *
       * `stageHunks` devuelve el `WorkingStatus` nuevo, y cambiarlo es lo que
       * hace que `DiffViewer` vuelva a pedir su diff: el archivo tiene ahora
       * otras líneas de este lado. Pedirlo aquí además sería el mismo viaje dos
       * veces.
       */
      stageHunk: (path, hunkId, direction, precondition, ignoreWhitespace) => {
        write(async () => {
          const request = { path, hunkIds: [hunkId], precondition, ignoreWhitespace };
          applyStatus(
            direction === 'stage'
              ? await git.stageHunks(repoId, request)
              : await git.unstageHunks(repoId, request),
          );
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key:
              direction === 'stage' ? 'working.status.hunkStaged' : 'working.status.hunkUnstaged',
            params: { path },
          });
        });
      },

      stageLines: (path, lines, direction, precondition, ignoreWhitespace) => {
        write(async () => {
          const request = { path, lines, precondition, ignoreWhitespace };
          applyStatus(
            direction === 'stage'
              ? await git.stageLines(repoId, request)
              : await git.unstageLines(repoId, request),
          );
          applyUndoStack(await git.readUndoStack(repoId));
        });
      },

      // Descartar es lo único de la vista que ni se deshace ni git lo guarda
      // (CU-6), así que pasa por su confirmación igual que `discard`.
      discardLines: (path, lines, precondition, ignoreWhitespace) => {
        store().openDialog({
          kind: 'discardLines',
          request: { path, lines, precondition, ignoreWhitespace },
        });
      },

      confirmMerge: (source, target, precondition) => {
        store().closeActionPreview();
        write(async () => {
          await git.merge(repoId, source, { precondition });
          applyRefs(await git.readRefs(repoId));
          applyStatus(await git.readStatus(repoId));
          store().bumpHistory();
          shell().setStatus({
            tone: 'success',
            key: 'working.status.merged',
            params: { source, target },
          });
        });
      },

      confirmRebase: (source, target, precondition) => {
        store().closeActionPreview();
        write(async () => {
          await git.rebase(repoId, source, { precondition });
          applyRefs(await git.readRefs(repoId));
          applyStatus(await git.readStatus(repoId));
          store().bumpHistory();
          shell().setStatus({
            tone: 'success',
            key: 'working.status.rebased',
            params: { source, target },
          });
        });
      },

      stash: (message, includeUntracked, paths) => {
        closeDialog();
        write(async () => {
          const precondition = store().context?.resetPrecondition;
          const nextRefs = await git.createStash(repoId, message, {
            includeUntracked,
            paths,
            precondition,
          });
          applyRefs(nextRefs);
          applyStatus(await git.readStatus(repoId));
          const created = nextRefs.stashes.reduce<Stash | undefined>(
            (latest, stash) =>
              latest === undefined || stash.index < latest.index ? stash : latest,
            undefined,
          );
          if (created) store().setSelectedCommits(new Set([`stash:${String(created.index)}`]));
          setWipName(null);
          store().closeDiff();
          shell().setStatus({
            tone: 'success',
            key: 'working.status.stashed',
            params: { branch: store().context?.headBranch ?? '' },
          });
        });
      },

      renameStash: (stash, message) => {
        write(async () => {
          applyRefs(
            await git.renameStash(repoId, stash.index, message, { expectedStash: stash.sha }),
          );
        });
      },

      stashPaths: (paths) => {
        write(async () => {
          const wipName = store().context?.headBranch ?? 'HEAD';
          const name = useWorkingStore.getState().wipName ?? `WIP en ${wipName}`;

          const precondition = store().context?.resetPrecondition;
          const nextRefs = await git.createStash(repoId, name, {
            includeUntracked: true,
            paths,
            precondition,
          });
          applyRefs(nextRefs);
          applyStatus(await git.readStatus(repoId));
          const created = nextRefs.stashes.reduce<Stash | undefined>(
            (latest, stash) =>
              latest === undefined || stash.index < latest.index ? stash : latest,
            undefined,
          );
          if (created) store().setSelectedCommits(new Set([`stash:${String(created.index)}`]));
          store().closeDiff();
          shell().setStatus({
            tone: 'success',
            key: 'working.status.stashed',
            params: { branch: store().context?.headBranch ?? '' },
          });
        });
      },

      pop: (stash, drop) => {
        write(async () => {
          const precondition = store().context?.resetPrecondition;
          try {
            applyStatus(
              await git.applyStash(repoId, stash.index, {
                drop,
                expectedStash: stash.sha,
                precondition,
              }),
            );
          } catch (error) {
            // A conflicted apply writes the worktree despite rejecting. Show
            // Resolver immediately, even if a watcher notice is delayed.
            try {
              applyStatus(await git.readStatus(repoId));
              applyRefs(await git.readRefs(repoId));
            } catch {
              // Preserve the original stash error if refreshing also fails.
            }
            throw error;
          }
          applyRefs(await git.readRefs(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.popped',
            params: {},
          });
        });
      },

      dropStash: (stash) => {
        store().openDialog({ kind: 'dropStash', stash });
      },

      confirmDropStash: (stash) => {
        closeDialog();
        write(async () => {
          applyRefs(await git.dropStash(repoId, stash.index, { expectedStash: stash.sha }));
        });
      },

      undo: () => {
        recover(async () => {
          await git.undo(repoId);
          applyRefs(await git.readRefs(repoId));
          applyStatus(await git.readStatus(repoId));
          store().bumpHistory();
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.undone',
            params: {},
          });
        });
      },

      redo: () => {
        recover(async () => {
          await git.redo(repoId);
          applyRefs(await git.readRefs(repoId));
          applyStatus(await git.readStatus(repoId));
          store().bumpHistory();
          applyUndoStack(await git.readUndoStack(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.redone',
            params: {},
          });
        });
      },

      continueOperation: () => {
        write(async () => {
          await closeOperation(() => git.continueOperation(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.operationContinued',
            params: {},
          });
        });
      },

      abortOperation: () => {
        write(async () => {
          await closeOperation(() => git.abortOperation(repoId));
          shell().setStatus({
            tone: 'success',
            key: 'working.status.operationAborted',
            params: {},
          });
        });
      },

      fetch: (remote) => {
        startFetch(remote);
      },

      cancelNetwork: () => {
        networkAbort.current?.abort();
      },

      pull: (strategy) => {
        let result: Awaited<ReturnType<typeof git.pull>> | null = null;
        startNetwork(
          'working.pull',
          async (controller, onProgress) => {
            try {
              result = await git.pull(
                repoId,
                { strategy: strategy ?? 'auto', onProgress },
                { signal: controller.signal },
              );
            } finally {
              const [refs, status] = await Promise.allSettled([
                git.readRefs(repoId),
                git.readStatus(repoId),
              ]);
              if (refs.status === 'fulfilled') applyRefs(refs.value);
              if (status.status === 'fulfilled') applyStatus(status.value);
              store().bumpHistory();
            }
          },
          () => {
            if (result === null) return;
            shell().setStatus({
              tone: 'success',
              key:
                result.strategy === 'rebase'
                  ? 'working.status.pullRebase'
                  : 'working.status.pullMerge',
              params: {},
            });
          },
        );
      },

      push: (options) => {
        const context = store().context;
        const headBranch = context?.headBranch ?? null;

        if (headBranch === null) return;
        if (context?.headUpstream === null && options?.setUpstream !== true) {
          store().openDialog({
            kind: 'publishBranch',
            branch: headBranch,
            remotes: context.remoteNames,
          });
          return;
        }

        let pushed = false;
        startNetwork(
          'working.push',
          async (controller, onProgress) => {
            try {
              applyRefs(
                await git.push(
                  repoId,
                  headBranch,
                  { ...options, onProgress },
                  { signal: controller.signal },
                ),
              );
              pushed = true;
            } catch (error: unknown) {
              if (isCancelled(error)) throw error;

              const gitError = toGitOperationError(error);
              const observed = context?.headUpstream;
              const rejected = gitError.params as { branch: string; remote: string };
              if (
                gitError.code === 'push.rejected' &&
                observed !== null &&
                observed !== undefined &&
                observed.remote === rejected.remote
              ) {
                store().openPushRejected({
                  branch: rejected.branch,
                  remote: rejected.remote,
                  expectedRemoteTip: observed.tip,
                });
                return;
              }
              throw error;
            }
          },
          () => {
            if (!pushed) return;
            shell().setStatus({
              tone: 'success',
              key: 'working.status.pushed',
              params: { branch: headBranch },
            });
          },
        );
      },

      pullAndRetryPush: () => {
        const headBranch = store().context?.headBranch ?? null;

        if (headBranch === null) return;

        startNetwork(
          'working.push',
          async (controller, onProgress) => {
            await git.pull(repoId, { strategy: 'auto', onProgress }, { signal: controller.signal });
            applyRefs(await git.readRefs(repoId));
            applyStatus(await git.readStatus(repoId));
            store().bumpHistory();
            applyRefs(
              await git.push(repoId, headBranch, { onProgress }, { signal: controller.signal }),
            );
          },
          () => {
            shell().setStatus({
              tone: 'success',
              key: 'working.status.pushed',
              params: { branch: headBranch },
            });
          },
        );
      },
    };
  }, [
    applyRepository,
    applyRefs,
    applyStatus,
    applyUndoStack,
    git,
    repoId,
    repoPath,
    persistWipName,
    setAllSectionsCollapsed,
    setNodeForm,
    system,
  ]);
}

/** Ruta absoluta de la carpeta que contiene un archivo, o la propia carpeta. */
export function revealFolderPath(repoPath: string, path: string): string {
  const relative = path.endsWith('/')
    ? path.replace(/\/+$/, '')
    : path.split('/').slice(0, -1).join('/');
  const root = repoPath.replace(/\/+$/, '');

  return relative === '' ? root : `${root}/${relative}`;
}

/**
 * Copiar al portapapeles, sin puerto propio.
 *
 * No es una salida al sistema como las de `SystemPort` —no abre nada, no lee
 * nada del disco— sino la misma API que cualquier página tiene, y en la ventana
 * de Tauri funciona igual. Va con respaldo porque `navigator.clipboard` no
 * existe en jsdom ni en contextos no seguros, y quedarse sin copiar un SHA no
 * puede tumbar la vista.
 */
async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);

    return;
  }

  throw new Error('sin portapapeles');
}
