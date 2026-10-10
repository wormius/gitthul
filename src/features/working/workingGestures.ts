import { useMemo } from 'react';

import type { GestureDefinition } from '@app/gestures';
import { useShellStore } from '@app/shellStore';
import { activeTab } from '@app/tabs';
import { useI18n } from '@i18n/useI18n';

import { canCommit } from './commitMessage';
import { useWorkingStore } from './workingStore';

/**
 * Los gestos de GitWorking, para que `GestureProvider` los concatene con los
 * del shell y los de Repositorios.
 *
 * **Solo entran las acciones que ya tienen un `run()` de verdad**, que es el
 * criterio que F2.2 dejó fijado con los siete botones sin fase de
 * `GitActionBar`: un gesto que no hace nada no es un gesto, es un atajo roto
 * con nombre. Las entradas de menú deshabilitadas de `contextMenus.ts` —
 * fusionar, rebasar, comparar, pop, publicar— no se declaran aquí hasta que
 * F2.5, F2.7, F2.8 y F2.9 les den lógica.
 *
 * **Los gestos que actúan sobre un objeto señalado leen el store, no el árbol.**
 * `run()` no lleva parámetros, así que `working.stage`, `working.checkout` y los
 * once que se les parecen necesitan que la selección de archivos y la de
 * referencias vivan en `workingStore` y no en el `useState` de su panel. Por eso
 * estuvieron fuera del registro hasta el 4 de agosto de 2026, cuando se subieron
 * las dos selecciones. Quien ejecuta sigue siendo `useWorkingActions`: el menú y
 * el botón de la fila le pasan el objeto que tienen delante —lo saben mejor que
 * el store—, y lo que el registro aporta es el nombre único, el atajo y la
 * búsqueda global. Es el reparto que `working.cherryPick` ya usaba.
 *
 * Lo que un gesto puede hacer sin contexto lo decide el store: `context` trae
 * el repositorio abierto y su rama activa, y `selectedCommits` la selección. Un
 * gesto que necesita algo que no hay se declara **deshabilitado** en vez de
 * desaparecer: la búsqueda global sigue diciendo que la acción existe y por qué
 * ahora no se puede.
 *
 * **Fuera de GitWorking están deshabilitados y fuera de la búsqueda.** Se está
 * «en GitWorking» cuando la pestaña activa enseña esa superficie; una terminal
 * tiene su propia pestaña y el atajo no tendría dónde actuar.
 */
export function useWorkingGestureDefinitions(): readonly GestureDefinition[] {
  const { t } = useI18n();
  const tab = useShellStore(activeTab);
  const settingsOpen = useShellStore((state) => state.settingsOpen);
  const refsCollapsed = useWorkingStore((state) => state.refsCollapsed);
  const detailsCollapsed = useWorkingStore((state) => state.detailsCollapsed);
  const setRefsCollapsed = useWorkingStore((state) => state.setRefsCollapsed);
  const setDetailsCollapsed = useWorkingStore((state) => state.setDetailsCollapsed);
  const context = useWorkingStore((state) => state.context);
  const selected = useWorkingStore((state) => state.selectedCommits);
  const fileSelection = useWorkingStore((state) => state.fileSelection);
  const selectedRef = useWorkingStore((state) => state.selectedRef);
  const openDialog = useWorkingStore((state) => state.openDialog);
  const openFileHistory = useWorkingStore((state) => state.openFileHistory);
  const openDiff = useWorkingStore((state) => state.openDiff);
  const requestFileAction = useWorkingStore((state) => state.requestFileAction);
  const requestCheckout = useWorkingStore((state) => state.requestCheckout);
  const requestGoTo = useWorkingStore((state) => state.requestGoTo);
  const fileView = useWorkingStore((state) => state.fileView);
  const setFileView = useWorkingStore((state) => state.setFileView);
  const requestFilterFocus = useWorkingStore((state) => state.requestFilterFocus);
  const diff = useWorkingStore((state) => state.diff);
  const closeDiff = useWorkingStore((state) => state.closeDiff);
  const draft = useWorkingStore((state) => state.commitDraft);
  const requestCommit = useWorkingStore((state) => state.requestCommit);
  const openActionPreview = useWorkingStore((state) => state.openActionPreview);
  const openCompare = useWorkingStore((state) => state.openCompare);
  const requestUndo = useWorkingStore((state) => state.requestUndo);
  const requestRedo = useWorkingStore((state) => state.requestRedo);
  const requestPop = useWorkingStore((state) => state.requestPop);
  const requestContinue = useWorkingStore((state) => state.requestContinue);
  const requestAbort = useWorkingStore((state) => state.requestAbort);
  const requestFetch = useWorkingStore((state) => state.requestFetch);
  const requestPull = useWorkingStore((state) => state.requestPull);
  const requestPush = useWorkingStore((state) => state.requestPush);
  const requestCancelNetwork = useWorkingStore((state) => state.requestCancelNetwork);
  const networkBusy = useWorkingStore((state) => state.networkBusy);
  const networkProgress = useWorkingStore((state) => state.networkProgress);

  return useMemo<readonly GestureDefinition[]>(() => {
    const viewingWorking = tab?.surface.kind === 'working';
    const away = !viewingWorking || settingsOpen;
    const head = context?.headBranch ?? null;
    const noHead = away || context === null;

    /*
     * Las dos acciones sobre la selección necesitan commits marcados y una rama
     * activa a la que traerlos: con HEAD desacoplado no hay destino que
     * nombrar, y la invariante 5 no admite «cherry-pick aquí».
     *
     * La selección incluye también el nodo WIP y los guardados, que no son
     * commits que se puedan traer; se quedan fuera. Y el orden que sale de un
     * `Set` es el de los clics, no el del historial, así que desde la búsqueda
     * la vista previa se marca como no contigua y avisa de que el orden
     * importa — desde el menú de la tabla, que sí sabe el orden de las filas,
     * llega bien ordenada.
     */
    const shas = [...selected].filter((key) => key !== 'wip' && !key.startsWith('stash:'));
    const withoutSelection = noHead || head === null || shas.length === 0;

    // Hacer el commit pide las dos cosas que el botón del compositor mira: algo
    // en el stage y un resumen escrito. El atajo no puede ser más permisivo que
    // el botón, o `Mod+Enter` fallaría en silencio.
    const noCommit = noHead || !canCommit(draft.summary, context?.stagedCount ?? 0, draft.amend);

    /*
     * Los gestos que actúan sobre un objeto señalado en un panel.
     *
     * `run()` no lleva parámetros, así que lo único que un gesto alcanza es lo
     * que el store sabe: la selección de archivos —con la lista de la que
     * salió, porque pasar al stage y quitar del stage son opuestas— y la
     * referencia marcada en el panel izquierdo. Sin eso los trece se quedarían
     * fuera del registro, que es donde estuvieron hasta el 4 de agosto de 2026.
     */
    const paths = fileSelection?.paths ?? [];
    const fileCount = paths.length;
    const fromTracking = fileSelection?.list === 'tracking' && fileCount > 0;
    const fromStage = fileSelection?.list === 'stage' && fileCount > 0;
    const noFiles = away || fileCount === 0;
    const onePath = fileCount === 1 ? paths[0] : undefined;
    const ref = away ? null : selectedRef;
    const branchRef = ref !== null && ref.kind !== 'tag' ? ref : null;
    const tagRef = ref?.kind === 'tag' ? ref : null;
    const integrationSource = branchRef?.name === head ? null : branchRef;
    const comparisonSource = ref?.name === head ? null : ref;
    const oneCommit = shas.length === 1 ? shas[0] : undefined;

    return [
      {
        id: 'working.toggleRefs',
        label: refsCollapsed ? t('gesture.working.expandRefs') : t('gesture.working.collapseRefs'),
        triggers: ['button', 'search'],
        disabled: away,
        hiddenInSearch: away,
        run: () => {
          setRefsCollapsed(!refsCollapsed);
        },
      },
      {
        id: 'working.toggleDetails',
        label: detailsCollapsed
          ? t('gesture.working.expandDetails')
          : t('gesture.working.collapseDetails'),
        triggers: ['button', 'search'],
        disabled: away,
        hiddenInSearch: away,
        run: () => {
          setDetailsCollapsed(!detailsCollapsed);
        },
      },
      {
        id: 'working.goToHead',
        label: t('gesture.working.goToHead', { branch: head ?? '' }),
        triggers: ['button', 'search'],
        disabled: noHead,
        hiddenInSearch: away,
        run: () => {
          if (context) requestGoTo(context.headSha);
        },
      },
      {
        id: 'working.createBranch',
        label: t('gesture.working.createBranch', { from: head ?? '' }),
        triggers: ['menu', 'shortcut', 'search'],
        shortcut: 'Mod+B',
        shortcutName: t('settings.shortcuts.createBranch'),
        disabled: noHead || head === null,
        hiddenInSearch: away,
        run: () => {
          if (head === null) return;

          openDialog({
            kind: 'createBranch',
            from: { kind: 'branch', name: head },
            fromLabel: head,
          });
        },
      },
      {
        id: 'working.recoverHistory',
        label: t('gesture.working.recoverHistory'),
        triggers: ['search'],
        disabled: noHead,
        hiddenInSearch: away,
        run: () => {
          openDialog({ kind: 'recoverHistory' });
        },
      },
      {
        id: 'working.createTag',
        label: t('gesture.working.createTag', { at: head ?? '' }),
        triggers: ['menu', 'search'],
        disabled: noHead || head === null,
        hiddenInSearch: away,
        run: () => {
          if (head === null) return;

          openDialog({ kind: 'createTag', at: { kind: 'branch', name: head }, atLabel: head });
        },
      },
      {
        id: 'working.createWorktree',
        label: t('gesture.working.createWorktree'),
        triggers: ['menu', 'search'],
        disabled: noHead,
        hiddenInSearch: away,
        run: () => {
          openDialog({ kind: 'createWorktree', branch: head });
        },
      },
      {
        /*
         * Los tres gestos de la referencia señalada. El doble clic de la fila
         * sigue llamando a `useWorkingActions` con el objeto que tiene delante
         * —sabe mejor que el store sobre qué se pulsó—; lo que el registro
         * aporta es el nombre único, el atajo y la búsqueda. Es el mismo
         * reparto que ya tenían `cherryPick` y `revert` con el menú de la tabla.
         */
        id: 'working.checkout',
        label:
          ref === null
            ? t('gesture.working.checkoutNone')
            : t('gesture.working.checkout', { ref: ref.name }),
        triggers: ['activate', 'menu', 'search'],
        disabled: away || ref === null || ref.isHead,
        hiddenInSearch: away,
        run: () => {
          if (ref === null || ref.isHead) return;

          requestCheckout(
            ref.kind === 'tag'
              ? { kind: 'tag', name: ref.name }
              : ref.kind === 'remoteBranch'
                ? {
                    kind: 'remoteBranch',
                    name: ref.name,
                    remote: ref.remote ?? ref.name.split('/')[0] ?? ref.name,
                  }
                : { kind: 'branch', name: ref.name },
            ref.name,
          );
        },
      },
      {
        id: 'working.deleteBranch',
        label:
          branchRef === null
            ? t('gesture.working.deleteBranchNone')
            : t('gesture.working.deleteBranch', { branch: branchRef.name }),
        triggers: ['menu', 'search'],
        // La rama activa no se borra: git tampoco deja, y el diálogo tendría
        // que explicar un fallo que se puede evitar antes de abrirlo.
        disabled: away || branchRef === null || branchRef.isHead,
        hiddenInSearch: away,
        run: () => {
          if (branchRef === null || branchRef.isHead) return;

          openDialog({
            kind: 'deleteBranch',
            branch: branchRef.name,
            expectedTip: branchRef.target,
          });
        },
      },
      {
        id: 'working.deleteTag',
        label:
          tagRef === null
            ? t('gesture.working.deleteTagNone')
            : t('gesture.working.deleteTag', { tag: tagRef.name }),
        triggers: ['menu', 'search'],
        disabled: away || tagRef === null,
        hiddenInSearch: away,
        run: () => {
          if (tagRef === null) return;

          openDialog({ kind: 'deleteTag', tag: tagRef.name, expectedTip: tagRef.target });
        },
      },
      {
        id: 'working.cherryPick',
        label: t('gesture.working.cherryPick', { branch: head ?? '' }),
        triggers: ['menu', 'search'],
        disabled: withoutSelection,
        hiddenInSearch: away,
        run: () => {
          if (context === null || context.headBranch === null) return;
          openDialog({
            kind: 'cherryPick',
            shas,
            contiguous: shas.length === 1,
            precondition: { targetRef: context.headBranch, targetOid: context.headSha },
          });
        },
      },
      {
        id: 'working.revert',
        label: t('gesture.working.revert', { branch: head ?? '' }),
        triggers: ['menu', 'search'],
        disabled: withoutSelection,
        hiddenInSearch: away,
        run: () => {
          if (context === null || context.headBranch === null) return;
          openDialog({
            kind: 'revert',
            shas,
            contiguous: shas.length === 1,
            precondition: { targetRef: context.headBranch, targetOid: context.headSha },
          });
        },
      },
      {
        /*
         * Restablecer nombra las dos cosas que toca —la rama activa y el commit
         * al que va—, así que pide exactamente un commit marcado. El modo lo
         * elige el diálogo: `mixed` es con el que abre, que es el de git.
         */
        id: 'working.reset',
        label:
          oneCommit === undefined || head === null
            ? t('gesture.working.resetNone')
            : t('gesture.working.reset', { branch: head, sha: oneCommit.slice(0, 7) }),
        triggers: ['menu', 'search'],
        disabled: noHead || head === null || oneCommit === undefined,
        hiddenInSearch: away,
        run: () => {
          if (oneCommit === undefined || context?.headBranch === null || context === null) return;

          openDialog({
            kind: 'reset',
            sha: oneCommit,
            mode: 'mixed',
            expectedBranch: context.headBranch,
            precondition: context.resetPrecondition,
          });
        },
      },
      {
        id: 'working.toggleFileTree',
        label:
          fileView === 'tree'
            ? t('gesture.working.fileListFlat')
            : t('gesture.working.fileListTree'),
        triggers: ['button', 'search'],
        disabled: away,
        hiddenInSearch: away,
        run: () => {
          setFileView(fileView === 'tree' ? 'flat' : 'tree');
        },
      },
      {
        // Ctrl/Cmd+F pertenece a shell.find, que busca en la vista activa.
        id: 'working.focusFilter',
        label: t('gesture.working.focusFilter'),
        triggers: ['search'],
        disabled: away,
        hiddenInSearch: away,
        run: requestFilterFocus,
      },
      {
        /*
         * Los nueve gestos de archivo. Todos leen `fileSelection`, y los que
         * escriben dejan su petición para que la atienda `WorkingView`, que es
         * quien tiene los puertos — el mismo patrón que `commitRequest`.
         *
         * Pasar al stage solo se ofrece desde Seguimiento y quitar solo desde
         * Stage: son las dos direcciones del mismo movimiento, y ofrecer la que
         * no toca dejaría un gesto que no puede hacer nada con algo marcado.
         */
        id: 'working.stage',
        label: fromTracking
          ? t('gesture.working.stage', { count: fileCount })
          : t('gesture.working.stageNone'),
        triggers: ['button', 'activate', 'menu', 'hoverAction', 'search'],
        disabled: away || !fromTracking,
        hiddenInSearch: away,
        run: () => {
          if (!fromTracking) return;

          requestFileAction('stage', paths);
        },
      },
      {
        id: 'working.unstage',
        label: fromStage
          ? t('gesture.working.unstage', { count: fileCount })
          : t('gesture.working.unstageNone'),
        triggers: ['button', 'activate', 'menu', 'hoverAction', 'search'],
        disabled: away || !fromStage,
        hiddenInSearch: away,
        run: () => {
          if (!fromStage) return;

          requestFileAction('unstage', paths);
        },
      },
      {
        id: 'working.stageAll',
        label: t('gesture.working.stageAll'),
        triggers: ['button', 'menu', 'search'],
        disabled: away || (context?.trackedCount ?? 0) === 0,
        hiddenInSearch: away,
        run: () => {
          requestFileAction('stageAll', []);
        },
      },
      {
        id: 'working.unstageAll',
        label: t('gesture.working.unstageAll'),
        triggers: ['button', 'menu', 'search'],
        disabled: away || (context?.stagedCount ?? 0) === 0,
        hiddenInSearch: away,
        run: () => {
          requestFileAction('unstageAll', []);
        },
      },
      {
        // Descartar es lo único de la vista que ni se deshace ni git guarda, así
        // que el gesto abre el diálogo y nunca escribe — invariante 2. Y solo
        // desde Seguimiento: lo reversible del índice ya es quitar del stage.
        id: 'working.discard',
        label: fromTracking
          ? t('gesture.working.discard', { count: fileCount })
          : t('gesture.working.discardNone'),
        triggers: ['menu', 'search'],
        disabled: away || !fromTracking,
        hiddenInSearch: away,
        run: () => {
          if (!fromTracking) return;

          requestFileAction('discard', paths);
        },
      },
      {
        id: 'working.ignorePath',
        label:
          fileCount > 0
            ? t('gesture.working.ignorePath', { count: fileCount })
            : t('gesture.working.ignorePathNone'),
        triggers: ['menu', 'search'],
        disabled: noFiles,
        hiddenInSearch: away,
        run: () => {
          if (fileCount === 0) return;

          requestFileAction('ignore', paths);
        },
      },
      {
        id: 'working.ignoreAndUntrack',
        label:
          fileCount > 0
            ? t('gesture.working.ignoreAndUntrack', { count: fileCount })
            : t('gesture.working.ignoreAndUntrackNone'),
        triggers: ['menu', 'search'],
        disabled: noFiles,
        hiddenInSearch: away,
        run: () => {
          if (fileCount === 0) return;

          requestFileAction('ignoreUntrack', paths);
        },
      },
      {
        id: 'working.viewFileHistory',
        label:
          onePath === undefined
            ? t('gesture.working.viewFileHistoryNone')
            : t('gesture.working.viewFileHistory', { path: onePath }),
        triggers: ['menu', 'search'],
        disabled: away || onePath === undefined,
        hiddenInSearch: away,
        run: () => {
          if (onePath === undefined) return;

          openFileHistory(onePath);
        },
      },
      {
        // El origen sale de la lista: Seguimiento enseña el árbol de trabajo y
        // Stage el índice, que es justo la diferencia que el visor pinta.
        id: 'working.openDiff',
        label:
          onePath === undefined
            ? t('gesture.working.openDiffNone')
            : t('gesture.working.openDiff', { path: onePath }),
        triggers: ['activate', 'menu', 'search'],
        disabled: away || onePath === undefined,
        hiddenInSearch: away,
        run: () => {
          if (onePath === undefined) return;

          openDiff({
            path: onePath,
            source: fileSelection?.list === 'stage' ? { kind: 'index' } : { kind: 'worktree' },
          });
        },
      },
      {
        id: 'working.commit',
        label: t('gesture.working.commit', { branch: head ?? '' }),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'Mod+Enter',
        shortcutName: t('settings.shortcuts.commit'),
        allowWhileTyping: true,
        disabled: noCommit,
        hiddenInSearch: away,
        run: () => {
          requestCommit(false);
        },
      },
      {
        /*
         * `Esc` **no** se declara aquí, y es la decisión 8 del subplan: el visor
         * lo captura mientras tiene el foco, como un campo de texto tiene
         * prioridad sobre el shell. Lo que sí pasa por el registro son el botón
         * de cerrar y la búsqueda global, que es donde la acción necesita
         * llamarse igual que en todas partes.
         */
        id: 'working.closeDiff',
        label: t('gesture.working.closeDiff'),
        triggers: ['button', 'search'],
        disabled: away || diff === null,
        hiddenInSearch: away,
        run: closeDiff,
      },
      {
        id: 'working.amend',
        label: t('gesture.working.amend', { branch: head ?? context?.headSha.slice(0, 7) ?? '' }),
        triggers: ['button', 'search'],
        disabled: noHead || !context?.headSha || context?.canAmend === false,
        hiddenInSearch: away,
        run: () => {
          requestCommit(true);
        },
      },
      {
        id: 'working.merge',
        label: t('gesture.working.merge', { branch: head ?? '' }),
        triggers: ['drag', 'menu', 'search'],
        disabled: noHead || head === null || integrationSource === null,
        hiddenInSearch: away,
        run: () => {
          if (head === null || integrationSource === null) return;

          openActionPreview({
            kind: 'merge',
            source: { kind: 'branch', name: integrationSource.name },
            target: { kind: 'branch', name: head },
            headBranch: head,
          });
        },
      },
      {
        id: 'working.rebase',
        label: t('gesture.working.rebase', { branch: head ?? '' }),
        triggers: ['drag', 'menu', 'search'],
        disabled: noHead || head === null || integrationSource === null,
        hiddenInSearch: away,
        run: () => {
          if (head === null || integrationSource === null) return;

          openActionPreview({
            kind: 'rebase',
            source: { kind: 'branch', name: integrationSource.name },
            target: { kind: 'branch', name: head },
            headBranch: head,
          });
        },
      },
      {
        id: 'working.compare',
        label: t('gesture.working.compare', { branch: head ?? '' }),
        triggers: ['drag', 'menu', 'search'],
        disabled: noHead || head === null || comparisonSource === null,
        hiddenInSearch: away,
        run: () => {
          if (head === null || comparisonSource === null) return;
          openCompare({
            kind: 'refs',
            source: { ref: comparisonSource.name, label: comparisonSource.name },
            target: { ref: head, label: head },
          });
        },
      },
      {
        id: 'working.undo',
        label: t('gesture.working.undo'),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'Mod+Z',
        disabled: noHead || networkBusy || (context?.undoCount ?? 0) === 0,
        hiddenInSearch: away,
        run: requestUndo,
      },
      {
        id: 'working.redo',
        label: t('gesture.working.redo'),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'Mod+Shift+Z',
        disabled: noHead || networkBusy || (context?.redoCount ?? 0) === 0,
        hiddenInSearch: away,
        run: requestRedo,
      },
      {
        id: 'working.stash',
        label: t('gesture.working.stash'),
        triggers: ['button', 'menu', 'shortcut', 'search'],
        shortcut: 'Mod+Shift+S',
        disabled: noHead || networkBusy || !context?.hasWip,
        hiddenInSearch: away,
        run: () => {
          if (!useWorkingStore.getState().context?.hasWip) return;

          useWorkingStore.getState().requestStash();
        },
      },
      {
        id: 'working.pop',
        label: t('gesture.working.pop'),
        triggers: ['button', 'menu', 'search'],
        disabled:
          noHead ||
          networkBusy ||
          selected.size !== 1 ||
          !context?.stashes?.some((stash) => selected.has(`stash:${String(stash.index)}`)),
        hiddenInSearch: away,
        run: requestPop,
      },
      {
        id: 'working.continueOperation',
        label: t('gesture.working.continueOperation'),
        triggers: ['button', 'menu', 'search'],
        disabled: noHead,
        hiddenInSearch: away,
        run: requestContinue,
      },
      {
        id: 'working.abortOperation',
        label: t('gesture.working.abortOperation'),
        triggers: ['button', 'menu', 'search'],
        disabled: noHead,
        hiddenInSearch: away,
        run: requestAbort,
      },
      {
        id: 'working.fetch',
        label: t('gesture.working.fetch'),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'Mod+Shift+G',
        disabled: noHead || networkBusy,
        hiddenInSearch: away,
        run: requestFetch,
      },
      {
        id: 'working.pull',
        label: t('gesture.working.pull'),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'Mod+Shift+P',
        disabled: noHead || networkBusy,
        hiddenInSearch: away,
        run: requestPull,
      },
      {
        id: 'working.push',
        label: t('gesture.working.push'),
        triggers: ['button', 'shortcut', 'search'],
        shortcut: 'Mod+Shift+U',
        disabled: noHead || networkBusy,
        hiddenInSearch: away,
        run: requestPush,
      },
      {
        id: 'working.cancelNetwork',
        label: t('gesture.working.cancelNetwork'),
        triggers: ['button', 'search'],
        disabled: !networkBusy || networkProgress === null,
        hiddenInSearch: away || !networkBusy || networkProgress === null,
        run: requestCancelNetwork,
      },
    ];
  }, [
    closeDiff,
    context,
    detailsCollapsed,
    diff,
    draft,
    fileSelection,
    fileView,
    networkBusy,
    networkProgress,
    openActionPreview,
    openCompare,
    openDialog,
    openDiff,
    openFileHistory,
    refsCollapsed,
    requestAbort,
    requestCancelNetwork,
    requestCheckout,
    requestCommit,
    requestContinue,
    requestFetch,
    requestFileAction,
    requestFilterFocus,
    requestGoTo,
    requestPop,
    requestPull,
    requestPush,
    requestRedo,
    requestUndo,
    selected,
    selectedRef,
    settingsOpen,
    setDetailsCollapsed,
    setFileView,
    setRefsCollapsed,
    t,
    tab,
  ]);
}
