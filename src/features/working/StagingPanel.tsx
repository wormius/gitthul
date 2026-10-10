import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { useGestures } from '@app/GestureContext';

import type { Branch } from '@core/domain/refs';
import type { FileChange, WorkingStatus } from '@core/domain/status';
import type { RepoId } from '@core/domain/repository';
import type { Sha } from '@core/domain/commit';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { IconButton } from '@ui/IconButton';
import { Counter } from '@ui/Counter';
import { SplitPane } from '@ui/SplitPane';

import { CommitComposer } from './CommitComposer';
import {
  folderMenu,
  stagedFileMenu,
  unstagedFileMenu,
  type MenuBuildContext,
} from './contextMenus';
import { FileList, type FileMenuTarget, type QuickAction } from './FileList';
import { FileListToolbar } from './FileListToolbar';
import type { RowMenu } from './CommitRow';
import styles from './StagingPanel.module.css';
import { visibleFiles } from './staging';
import type { WorkingActions } from './useWorkingActions';
import { useWorkingStore } from './workingStore';
import { StageIcon, UnstageIcon } from './WorkingIcons';

interface StagingPanelProps {
  repoId: RepoId;
  status: WorkingStatus;
  head: Branch | null;
  headName: string;
  headSha: Sha;
  menuContext: MenuBuildContext;
  actions: WorkingActions;
}

const NOTHING: ReadonlySet<string> = new Set();

/**
 * Seguimiento y Stage, con su divisor y el compositor debajo — CU-6 y CU-7.
 *
 * Sustituye a `ChangedFilesPanel`, la versión mínima que F2.4 montó para que sus
 * dos menús de archivo tuvieran fila donde pulsarse.
 *
 * **Los archivos en conflicto van en Seguimiento**, no en una tercera lista: son
 * cambios sin preparar que hay que resolver, y pasarlos al stage es exactamente
 * como git marca un conflicto por resuelto. Resolverlos de verdad es Resolver,
 * F3.x, y esta vista solo lleva hasta la puerta.
 */
export function StagingPanel({
  repoId,
  status,
  head,
  headName,
  headSha,
  menuContext,
  actions,
}: StagingPanelProps) {
  const { t } = useI18n();
  const gestures = useGestures();

  const contextPrecondition = useWorkingStore((state) => state.context?.resetPrecondition);
  const discardPrecondition = status.resetPrecondition ?? contextPrecondition;
  const view = useWorkingStore((state) => state.fileView);
  const sort = useWorkingStore((state) => state.fileSort);
  const filter = useWorkingStore((state) => state.fileFilter);
  const setView = useWorkingStore((state) => state.setFileView);
  const setSort = useWorkingStore((state) => state.setFileSort);
  const setFilter = useWorkingStore((state) => state.setFileFilter);
  const filterFocus = useWorkingStore((state) => state.filterFocus);
  const [trackingTreeExpanded, setTrackingTreeExpanded] = useState(true);
  const [stageTreeExpanded, setStageTreeExpanded] = useState(true);
  const [composerMinimumHeight, setComposerMinimumHeight] = useState(280);
  /*
   * Una sola selección para las dos listas, y vive en el store.
   *
   * Lo primero ya lo decía el comentario que había aquí —marcar en Seguimiento
   * no puede dejar marcado algo en Stage, porque las acciones de las dos listas
   * son opuestas— pero con un `useState` por lista el código hacía lo contrario.
   * Lo segundo es lo que deja declarar los gestos de archivo en el registro:
   * `run()` no lleva parámetros, así que sobre lo que actúan tiene que ser algo
   * que el store sepa.
   */
  const fileSelection = useWorkingStore((state) => state.fileSelection);
  const setFileSelection = useWorkingStore((state) => state.setFileSelection);

  const trackingSelection = useMemo<ReadonlySet<string>>(
    () => (fileSelection?.list === 'tracking' ? new Set(fileSelection.paths) : NOTHING),
    [fileSelection],
  );

  const stageSelection = useMemo<ReadonlySet<string>>(
    () => (fileSelection?.list === 'stage' ? new Set(fileSelection.paths) : NOTHING),
    [fileSelection],
  );

  const selectTracking = useCallback(
    (selected: ReadonlySet<string>) => {
      setFileSelection(selected.size === 0 ? null : { list: 'tracking', paths: [...selected] });
    },
    [setFileSelection],
  );

  const selectStage = useCallback(
    (selected: ReadonlySet<string>) => {
      setFileSelection(selected.size === 0 ? null : { list: 'stage', paths: [...selected] });
    },
    [setFileSelection],
  );

  const rawTracking = useMemo<readonly FileChange[]>(
    () => [...status.conflicted, ...status.unstaged],
    [status.conflicted, status.unstaged],
  );

  const tracking = rawTracking;
  const stagedFiles = status.staged;

  const matches = useMemo(
    () =>
      visibleFiles(tracking, filter, sort).length + visibleFiles(stagedFiles, filter, sort).length,
    [filter, sort, stagedFiles, tracking],
  );

  const trackingMenu = useCallback(
    (target: FileMenuTarget): RowMenu =>
      target.kind === 'folder'
        ? {
            items: folderMenu(menuContext, { path: target.path, paths: target.paths }),
            label: t('working.menu.folder.label', { folder: target.path }),
          }
        : {
            items: unstagedFileMenu(menuContext, target.file, target.paths),
            label: t('working.menu.file.label', { path: target.file.path }),
            ...(target.paths.length > 1
              ? { description: t('working.menu.file.selection', { count: target.paths.length }) }
              : {}),
          },
    [menuContext, t],
  );

  const stageMenu = useCallback(
    (target: FileMenuTarget): RowMenu =>
      target.kind === 'folder'
        ? {
            items: folderMenu(menuContext, { path: target.path, paths: target.paths }),
            label: t('working.menu.folder.label', { folder: target.path }),
          }
        : {
            items: stagedFileMenu(menuContext, target.file, target.paths),
            label: t('working.menu.file.label', { path: target.file.path }),
            ...(target.paths.length > 1
              ? { description: t('working.menu.file.selection', { count: target.paths.length }) }
              : {}),
          },
    [menuContext, t],
  );

  const section = (
    title: string,
    files: readonly FileChange[],
    body: ReactNode,
    action: ReactNode,
    treeExpanded: boolean,
    onTreeExpandedChange: (expanded: boolean) => void,
  ) => (
    <section className={styles.section} aria-label={title}>
      <header className={styles.header}>
        <span className={styles.title}>{title}</span>
        <Counter value={files.length} />
        <span className={styles.spacer} />
        {action}
      </header>
      {view === 'tree' && (
        <button
          type="button"
          className={styles.treeAction}
          onClick={() => {
            onTreeExpandedChange(!treeExpanded);
          }}
        >
          {t(treeExpanded ? 'working.fileList.collapseAll' : 'working.fileList.expandAll')}
        </button>
      )}
      {body}
    </section>
  );

  const trackingTitle = t('working.staging.tracking');
  const stageTitle = t('working.staging.stage');

  /*
   * Cómo conviven las dos cosas que un archivo de estas listas sabe hacer.
   *
   * El clic simple abre el visor —CU-5, «clic en un archivo de cualquier lista
   * abre el visor superpuesto»— y la activación, que `FileList` ya distinguía
   * del clic, sigue pasando al stage o quitándolo, que es el gesto de CU-6. No
   * se pisan porque no son el mismo gesto: seleccionar y abrir son un clic, y
   * mover de lista son dos o Enter. Y si la activación mueve el archivo que el
   * visor tiene abierto, `useWorkingActions` reapunta el visor al otro origen en
   * vez de dejarlo enseñando un diff que ya está vacío.
   */
  const openTracking = useCallback(
    (path: string) => {
      actions.openDiff(path, { kind: 'worktree' });
    },
    [actions],
  );

  const openStage = useCallback(
    (path: string) => {
      actions.openDiff(path, { kind: 'index' });
    },
    [actions],
  );

  const stageQuickAction: QuickAction = useMemo(
    () => ({
      icon: <StageIcon />,
      label: t('working.staging.stageFile'),
      run: (path: string) => {
        actions.stage([path]);
      },
    }),
    [actions, t],
  );

  const unstageQuickAction: QuickAction = useMemo(
    () => ({
      icon: <UnstageIcon />,
      label: t('working.staging.unstageFile'),
      run: (path: string) => {
        actions.unstage([path]);
      },
    }),
    [actions, t],
  );

  return (
    <div className={styles.panel}>
      <FileListToolbar
        filter={filter}
        onFilterChange={setFilter}
        sort={sort}
        onSortChange={setSort}
        view={view}
        onViewChange={setView}
        matches={matches}
        focusRequest={filterFocus}
        actions={
          <IconButton
            aria-label={t('working.staging.discardAll')}
            disabled={tracking.length + stagedFiles.length === 0 || !discardPrecondition}
            icon={
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor">
                <path d="M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 6v6M9 6v6" />
              </svg>
            }
            onClick={() => {
              if (discardPrecondition)
                useWorkingStore.getState().openDialog({
                  kind: 'discardAll',
                  count: new Set([...tracking, ...stagedFiles].map((file) => file.path)).size,
                  precondition: discardPrecondition,
                });
            }}
          />
        }
      />

      <div className={styles.split}>
        <SplitPane
          orientation="vertical"
          label={t('working.split.composerLabel')}
          storageId="working.composer"
          defaultRatio={0.68}
          minFirst={120}
          minSecond={composerMinimumHeight}
          enforceMinimumSizes
          first={
            <div className={styles.lists}>
              <SplitPane
                orientation="vertical"
                label={t('working.split.stagingLabel')}
                storageId="working.staging"
                defaultRatio={0.5}
                minFirst={80}
                minSecond={80}
                first={section(
                  trackingTitle,
                  tracking,
                  <FileList
                    label={trackingTitle}
                    files={tracking}
                    view={view}
                    sort={sort}
                    filter={filter}
                    selected={trackingSelection}
                    onSelectedChange={selectTracking}
                    menuFor={trackingMenu}
                    onActivate={actions.stage}
                    onOpen={openTracking}
                    empty={t('working.staging.emptyTracking')}
                    quickAction={stageQuickAction}
                    showChangeDetails={false}
                    treeExpanded={trackingTreeExpanded}
                  />,
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`${styles.allAction} ${styles.stageAllAction}`}
                    disabled={tracking.length === 0}
                    onClick={() => {
                      // Los dos botones de «todo» no hablan de ningún archivo
                      // en concreto, así que sí pasan por el registro: son el
                      // camino `button` de `working.stageAll` y de su opuesto.
                      gestures.run('working.stageAll');
                    }}
                  >
                    {t('working.staging.stageAll')}
                  </Button>,
                  trackingTreeExpanded,
                  setTrackingTreeExpanded,
                )}
                second={section(
                  stageTitle,
                  stagedFiles,
                  <FileList
                    label={stageTitle}
                    files={stagedFiles}
                    view={view}
                    sort={sort}
                    filter={filter}
                    selected={stageSelection}
                    onSelectedChange={selectStage}
                    menuFor={stageMenu}
                    onActivate={actions.unstage}
                    onOpen={openStage}
                    empty={t('working.staging.emptyStage')}
                    quickAction={unstageQuickAction}
                    showChangeDetails={false}
                    treeExpanded={stageTreeExpanded}
                  />,
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`${styles.allAction} ${styles.unstageAllAction}`}
                    disabled={status.staged.length === 0}
                    onClick={() => {
                      gestures.run('working.unstageAll');
                    }}
                  >
                    {t('working.staging.unstageAll')}
                  </Button>,
                  stageTreeExpanded,
                  setStageTreeExpanded,
                )}
              />
            </div>
          }
          second={
            <CommitComposer
              repoId={repoId}
              head={head}
              headName={headName}
              headSha={headSha}
              stagedCount={status.staged.length}
              commitPrecondition={status.commitPrecondition}
              actions={actions}
              onMinimumHeightChange={setComposerMinimumHeight}
            />
          }
        />
      </div>
    </div>
  );
}
