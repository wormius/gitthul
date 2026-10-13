import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import { isCancelled } from '@core/domain/errors';
import type { WorkingStatus } from '@core/domain/status';
import type { Commit } from '@core/domain/commit';
import { useCommitPages } from '@features/working/useCommitPages';
import type { RefsSnapshot } from '@core/domain/refs';
import type { RepoSummary } from '@core/domain/repository';
import type { TerminalLayout } from '@core/domain/terminal';
import type { GitQuery } from '@core/ports/GitPort';
import { useI18n } from '@i18n/useI18n';
import { SplitPane } from '@ui/SplitPane';

import { TerminalPaneTree } from './TerminalPaneTree';
import { TerminalRefSidebar } from './TerminalRefSidebar';
import {
  activateTerminalPane,
  closeTerminalPane,
  initialTerminalLayout,
  renameTerminalPane,
  resizeTerminalSplit,
  splitTerminalPane,
  terminalPanes,
  updateTerminalPaneCwd,
} from './terminalLayout';
import styles from './TerminalView.module.css';

interface TerminalViewProps {
  /** Identificador de sesión, estable por pestaña. */
  sessionId: string;
  /** Carpeta del repositorio si hay base, o vacía. */
  cwd: string;
  /** Id del repositorio de la base, para cargar sus referencias. */
  repoId: string | null;
  layout?: TerminalLayout;
  onLayoutChange?: (layout: TerminalLayout) => void;
  onContextChange?: (cwd: string, repository: RepoSummary | null) => void;
  /** Abre o enfoca GitWorking para el repositorio observado por el pane activo. */
  onOpenWorking?: () => void;
  /** Cierra la superficie completa cuando se cierra su último panel. */
  onClose?: () => void;
}

interface TerminalRepositoryGraph {
  refs: RefsSnapshot;
  status: WorkingStatus;
}

const EMPTY_COMMITS: readonly Commit[] = [];

/**
 * La vista completa de la terminal: emulador + rail de referencias a la derecha.
 *
 * El rail es colapsable con `SplitPane` (collapsible: second). Sin repositorio
 * de base, el rail arranca vacío y plegado.
 */
export function TerminalView({
  sessionId,
  cwd,
  repoId,
  layout,
  onLayoutChange,
  onContextChange,
  onOpenWorking,
  onClose,
}: TerminalViewProps) {
  const { t } = useI18n();
  const { git } = usePorts();
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [activeRepoId, setActiveRepoId] = useState(repoId);
  const [localLayout, setLocalLayout] = useState(() => initialTerminalLayout(cwd));
  const currentLayout = layout ?? localLayout;
  const insertByPane = useRef(new Map<string, (text: string) => void>());
  const contextGeneration = useRef(0);

  const pages = useCommitPages(activeRepoId);

  // Referencias y estado del repositorio observado por el panel activo.
  const loadRepositoryGraph = useCallback(
    (query: GitQuery): Promise<TerminalRepositoryGraph | null> => {
      if (!activeRepoId) return Promise.resolve(null);

      return Promise.all([
        git.readRefs(activeRepoId, query),
        git.readStatus(activeRepoId, query),
      ]).then(([refs, status]) => ({ refs, status }));
    },
    [activeRepoId, git],
  );

  const graphData = useAsyncData(loadRepositoryGraph, {
    resourceKey: activeRepoId ?? '',
  });
  const reloadGraph = graphData.reload;
  const reloadCommits = pages.reload;

  useEffect(() => {
    if (!activeRepoId) return;
    const lifecycle = new AbortController();
    let stop: (() => void) | undefined;
    void git
      .watchRepository(
        activeRepoId,
        (change) => {
          if (lifecycle.signal.aborted) return;
          if (change.git || change.worktree) reloadGraph({ retain: true });
          if (change.git) reloadCommits({ retain: true });
        },
        { signal: lifecycle.signal },
      )
      .then((unsubscribe) => {
        if (lifecycle.signal.aborted) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((error: unknown) => {
        if (!lifecycle.signal.aborted && !isCancelled(error)) reloadGraph({ retain: true });
      });
    return () => {
      lifecycle.abort();
      stop?.();
    };
  }, [activeRepoId, git, reloadGraph, reloadCommits]);
  const repositoryGraph = graphData.status === 'ready' ? graphData.data : null;

  const handleInsert = useCallback(
    (text: string) => {
      insertByPane.current.get(currentLayout.activePaneId)?.(text);
    },
    [currentLayout.activePaneId],
  );

  const registerInsert = useCallback((paneId: string, insert: ((text: string) => void) | null) => {
    if (insert) insertByPane.current.set(paneId, insert);
    else insertByPane.current.delete(paneId);
  }, []);

  const updateLayout = useCallback(
    (next: TerminalLayout) => {
      if (next === currentLayout) return;
      setLocalLayout(next);
      onLayoutChange?.(next);
    },
    [currentLayout, onLayoutChange],
  );
  const panes = useMemo(() => terminalPanes(currentLayout.root), [currentLayout.root]);

  const updateContext = useCallback(
    (nextCwd: string) => {
      const generation = ++contextGeneration.current;
      void git
        .readRepository(nextCwd)
        .then((repository) => {
          if (contextGeneration.current !== generation) return;
          setActiveRepoId(repository.id);
          onContextChange?.(nextCwd, repository);
        })
        .catch(() => {
          if (contextGeneration.current !== generation) return;
          setActiveRepoId(null);
          onContextChange?.(nextCwd, null);
        });
    },
    [git, onContextChange],
  );

  const handleActivate = useCallback(
    (paneId: string) => {
      const pane = panes.find((candidate) => candidate.id === paneId);
      updateLayout(activateTerminalPane(currentLayout, paneId));
      if (pane && paneId !== currentLayout.activePaneId) updateContext(pane.cwd);
    },
    [currentLayout, panes, updateContext, updateLayout],
  );

  const handleCwd = useCallback(
    (paneId: string, nextCwd: string) => {
      updateLayout(updateTerminalPaneCwd(currentLayout, paneId, nextCwd));
      if (paneId === currentLayout.activePaneId) updateContext(nextCwd);
    },
    [currentLayout, updateContext, updateLayout],
  );

  const handleClose = useCallback(
    (paneId: string) => {
      if (panes.length === 1) {
        onClose?.();
        return;
      }
      updateLayout(closeTerminalPane(currentLayout, paneId));
    },
    [currentLayout, onClose, panes.length, updateLayout],
  );

  return (
    <div className={styles.view}>
      <SplitPane
        orientation="horizontal"
        label={t('view.terminal.railLabel')}
        storageId="terminal-rail-right"
        defaultRatio={0.8}
        minFirst={200}
        minSecond={140}
        collapsible="second"
        collapsed={activeRepoId === null || railCollapsed}
        onCollapsedChange={setRailCollapsed}
        collapsedSize={0}
        first={
          <TerminalPaneTree
            node={currentLayout.root}
            paneOrder={panes.map((pane) => pane.id)}
            activePaneId={currentLayout.activePaneId}
            repositoryPaneId={activeRepoId ? currentLayout.activePaneId : null}
            sessionPrefix={sessionId}
            placeholder={t('view.terminal.inputPlaceholder')}
            outputLabel={t('view.terminal.title')}
            errorMessage={t('view.terminal.startFailed')}
            searchLabel={t('view.terminal.searchLabel')}
            searchClearLabel={t('view.terminal.searchClear')}
            searchPreviousLabel={t('view.terminal.searchPrevious')}
            searchNextLabel={t('view.terminal.searchNext')}
            searchCloseLabel={t('view.terminal.searchClose')}
            searchResultsLabel={(current, total) =>
              t('view.terminal.searchResults', { current, total })
            }
            linkTitle={t('view.terminal.linkTitle')}
            linkDescription={(domain) => t('view.terminal.linkDescription', { domain })}
            linkOpenLabel={(domain) => t('view.terminal.linkOpen', { domain })}
            linkCancelLabel={t('view.terminal.linkCancel')}
            exitMessage={(exit) =>
              exit.signal
                ? t('view.terminal.exitedSignal', { signal: exit.signal })
                : exit.success
                  ? t('view.terminal.exitedSuccess')
                  : t('view.terminal.exitedCode', { code: exit.code })
            }
            paneName={(index) => t('view.terminal.paneName', { number: index })}
            activeLabel={t('view.terminal.paneActive')}
            renameLabel={t('view.terminal.renamePane')}
            splitHorizontalLabel={t('view.terminal.splitHorizontal')}
            splitVerticalLabel={t('view.terminal.splitVertical')}
            closeLabel={t('view.terminal.closePane')}
            openWorkingLabel={t('view.terminal.openWorking')}
            dividerLabel={t('view.terminal.paneDivider')}
            registerInsert={registerInsert}
            onActivate={handleActivate}
            onCwd={handleCwd}
            onOpenWorking={onOpenWorking}
            onRename={(paneId, title) =>
              updateLayout(renameTerminalPane(currentLayout, paneId, title))
            }
            onSplit={(paneId, orientation) =>
              updateLayout(splitTerminalPane(currentLayout, paneId, orientation))
            }
            onClose={handleClose}
            onResize={(splitId, ratio) =>
              updateLayout(resizeTerminalSplit(currentLayout, splitId, ratio))
            }
          />
        }
        second={
          <TerminalRefSidebar
            key={activeRepoId ?? ''}
            repoId={activeRepoId}
            refs={repositoryGraph?.refs ?? null}
            commits={
              activeRepoId && pages.state.status === 'ready' ? pages.state.commits : EMPTY_COMMITS
            }
            status={repositoryGraph?.status ?? null}
            loading={
              activeRepoId !== null &&
              (graphData.status === 'loading' || pages.state.status === 'loading')
            }
            loadingMore={pages.state.status === 'ready' && pages.state.loadingMore}
            error={
              graphData.status === 'failed'
                ? graphData.error
                : pages.state.status === 'failed'
                  ? pages.state.error
                  : null
            }
            onRetry={() => {
              reloadGraph();
              reloadCommits();
            }}
            onLoadMore={pages.loadMore}
            onInsert={handleInsert}
          />
        }
      />
    </div>
  );
}
