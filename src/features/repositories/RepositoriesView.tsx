import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { useGestures } from '@app/GestureContext';
import type { GestureRegistry } from '@app/gestures';
import type { RepoAvatar, RepoSort, Space } from '@core/domain/library';
import type { RepoId, RepoSummary } from '@core/domain/repository';
import { useTheme } from '@design/useTheme';
import type { I18nContextValue } from '@i18n/I18nContext';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { ContextMenu } from '@ui/ContextMenu';
import { EmptyState } from '@ui/EmptyState';
import type { MenuEntry } from '@ui/menuUtils';
import { Skeleton } from '@ui/Skeleton';
import { SplitPane } from '@ui/SplitPane';
import { VirtualList } from '@ui/VirtualList';

import { CloneRepoDialog } from './CloneRepoDialog';
import { CreateRepoDialog } from './CreateRepoDialog';
import { DeleteSpaceDialog } from './DeleteSpaceDialog';
import { ForgetRepoDialog } from './ForgetRepoDialog';
import { HomePanel } from './HomePanel';
import { OpenRepoFlow } from './OpenRepoFlow';
import { relativeTime } from './relativeTime';
import { RepoActionsBar } from './RepoActionsBar';
import { RepoAvatarDialog } from '@app/RepoAvatarDialog';
import { RepoFilterBar } from './RepoFilterBar';
import { RepoRow } from './RepoRow';
import { RepoSection } from './RepoSection';
import { RepoStatsPanel } from './RepoStatsPanel';
import { SpaceNameDialog } from './SpaceNameDialog';
import { CREATE_SPACE_TARGET, SpaceDropTargets } from './SpaceDropTargets';
import {
  ALL_ORIGIN,
  RECENT_ORIGIN,
  spaceOrigin,
  useRepositoriesStore,
  type RepositoriesDialog,
  type SelectionOrigin,
} from './repositoriesStore';
import { ALL_SECTION_ID, RECENT_SECTION_ID } from './repositoryGestures';
import { repoRowHeight } from './rowHeight';
import { nextSelection, recentRepositories, spacesOf, visibleRepositories } from './collection';
import { useRepositoryActions, type RepositoryActions } from './useRepositoryActions';
import { SpacesSection } from './SpacesSection';
import styles from './RepositoriesView.module.css';

const SKELETON_ROWS = 6;

/** Hogar de repositorios: Recientes y Todos comparten filtro, orden y selección. */
export function RepositoriesView() {
  const { t, locale } = useI18n();
  const { settings } = useTheme();
  const actions = useRepositoryActions();
  const gestures = useGestures();
  const repositories = useRepositoriesStore((state) => state.repositories);
  const library = useRepositoriesStore((state) => state.library);
  const readAt = useRepositoriesStore((state) => state.readAt);
  const listError = useRepositoriesStore((state) => state.listError);
  const folderError = useRepositoriesStore((state) => state.folderError);
  const openError = useRepositoriesStore((state) => state.openError);
  const selected = useRepositoriesStore((state) => state.selected);
  const selectedIds = useRepositoriesStore((state) => state.selectedIds);
  const batchBusy = useRepositoriesStore((state) => state.batchBusy);
  const batchFailures = useRepositoriesStore((state) => state.batchFailures);
  const setBatchFailures = useRepositoriesStore((state) => state.setBatchFailures);
  const filter = useRepositoriesStore((state) => state.filter);
  const dialog = useRepositoriesStore((state) => state.dialog);
  const renaming = useRepositoriesStore((state) => state.renaming);
  const dragging = useRepositoriesStore((state) => state.dragging);
  const dragOver = useRepositoriesStore((state) => state.dragOver);
  const select = useRepositoriesStore((state) => state.select);
  const selectMany = useRepositoriesStore((state) => state.selectMany);
  const setFilter = useRepositoriesStore((state) => state.setFilter);
  const setFolderError = useRepositoriesStore((state) => state.setFolderError);
  const openDialog = useRepositoriesStore((state) => state.openDialog);
  const closeDialog = useRepositoriesStore((state) => state.closeDialog);
  const setRenaming = useRepositoriesStore((state) => state.setRenaming);
  const setDragging = useRepositoriesStore((state) => state.setDragging);
  const setDragOver = useRepositoriesStore((state) => state.setDragOver);
  const panelScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void actions.load(controller.signal);
    return () => controller.abort();
  }, [actions]);

  const collator = useMemo(() => new Intl.Collator(locale, { numeric: true }), [locale]);
  const elapsed = useMemo(() => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }), [locale]);
  const sort = library?.sort ?? 'lastOpened';
  const layout = library?.layout ?? 'list';
  const filtering = filter.trim() !== '';
  const visible = useMemo(
    () => (repositories ? visibleRepositories({ repositories, sort, filter, collator }) : []),
    [collator, filter, repositories, sort],
  );
  const recent = useMemo(() => recentRepositories(repositories ?? []), [repositories]);
  const rowHeight = repoRowHeight(settings.density, settings.uiFontSize, false);
  const avatarOf = useCallback(
    (repo: RepoId): RepoAvatar | null => library?.avatars[repo] ?? null,
    [library],
  );
  const since = useCallback(
    (repo: RepoSummary) =>
      repo.lastOpenedAt === null
        ? t('repositories.row.never')
        : relativeTime(repo.lastOpenedAt, readAt, elapsed),
    [elapsed, readAt, t],
  );
  const getKey = useCallback((repo: RepoSummary) => repo.id, []);
  const selectedRepos = useMemo(() => {
    const byId = new Map((repositories ?? []).map((repo) => [repo.id, repo]));
    return [...selectedIds].flatMap((id) => {
      const repo = byId.get(id);
      return repo ? [repo] : [];
    });
  }, [repositories, selectedIds]);
  const pickFrom = useCallback(
    (origin: SelectionOrigin) => (next: ReadonlySet<string>) => selectMany(next, origin),
    [selectMany],
  );
  const contextPick = useCallback(
    (repo: RepoSummary, origin: SelectionOrigin) => {
      if (!selectedIds.has(repo.id)) select(repo, origin);
    },
    [select, selectedIds],
  );
  const activate = useCallback(
    (repo: RepoSummary) => {
      if (batchBusy) return;
      if (selectedRepos.length > 1) actions.openMany(selectedRepos);
      else actions.open(repo);
    },
    [actions, batchBusy, selectedRepos],
  );

  const clearOnDeadSpace = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;
    if (
      event.target.closest('a, button, input, [role="option"], [role="menuitem"], [role="toolbar"]')
    )
      return;
    select(null);
  };

  const rowMenuFor = useCallback(
    (repo: RepoSummary) =>
      rowMenu({
        repo,
        targets: selectedIds.has(repo.id) ? selectedRepos : [repo],
        busy: batchBusy,
        spaces: library?.spaces ?? [],
        t,
        gestures,
        actions,
        openDialog,
      }),
    [actions, batchBusy, gestures, library?.spaces, openDialog, selectedIds, selectedRepos, t],
  );

  const currentSpace = library?.view.kind === 'space' ? library.view.id : null;
  const draggedMemberships = useMemo(
    () =>
      dragging?.kind === 'repo'
        ? new Set(spacesOf(library?.spaces ?? [], dragging.repo.id).map((space) => space.id))
        : new Set<Space['id']>(),
    [dragging, library?.spaces],
  );
  const spaceMenuFor = useCallback(
    (space: Space, index: number): readonly MenuEntry[] => [
      {
        key: 'open-all-space',
        label: t('gesture.repos.openAllSpace', { space: space.name }),
        disabled: !repositories?.some((repo) => space.repos.includes(repo.id)),
        onSelect: () =>
          actions.openAll(
            space,
            (repositories ?? []).filter((repo) => space.repos.includes(repo.id)),
          ),
      },
      { kind: 'separator', key: 'after-open-all-space' },
      {
        key: 'rename-space',
        label: t('gesture.repos.renameSpace', { space: space.name }),
        ...shortcutFrom(gestures, 'repos.renameSpace'),
        onSelect: () => {
          actions.setView({ kind: 'space', id: space.id });
          setRenaming(space.id);
        },
      },
      {
        key: 'move-space-up',
        label: t('gesture.repos.moveSpaceUp', { space: space.name }),
        disabled: index === 0,
        onSelect: () => actions.moveSpace(space, index - 1),
      },
      {
        key: 'move-space-down',
        label: t('gesture.repos.moveSpaceDown', { space: space.name }),
        disabled: index === (library?.spaces.length ?? 0) - 1,
        onSelect: () => actions.moveSpace(space, index + 1),
      },
      { kind: 'separator', key: 'before-delete-space' },
      {
        key: 'delete-space',
        label: t('gesture.repos.deleteSpace', { space: space.name }),
        danger: true,
        onSelect: () => openDialog({ kind: 'deleteSpace', space }),
      },
    ],
    [actions, gestures, library?.spaces.length, openDialog, repositories, setRenaming, t],
  );
  const row =
    (origin: SelectionOrigin) =>
    (repo: RepoSummary): ReactNode => (
      <RepoRow
        repo={repo}
        avatar={avatarOf(repo.id)}
        selected={selectedIds.has(repo.id)}
        canOpenOnClick={selectedIds.size === 1}
        spaces={filtering ? spacesOf(library?.spaces ?? [], repo.id) : []}
        when={since(repo)}
        menu={rowMenuFor(repo)}
        onOpen={() => activate(repo)}
        onSelect={() => contextPick(repo, origin)}
        onDragStart={() => setDragging({ kind: 'repo', repo, from: null })}
        onDragEnd={() => setDragging(null)}
      />
    );

  const empty = filtering ? (
    <EmptyState
      size="sm"
      title={t('repositories.empty.filtered.title', { query: filter.trim() })}
      actions={
        <Button onClick={() => setFilter('')}>{t('repositories.empty.filtered.clear')}</Button>
      }
    />
  ) : (
    <EmptyState
      size="sm"
      title={t('repositories.empty.title')}
      description={t('repositories.empty.description')}
      actions={
        <Button variant="primary" onClick={() => gestures.run('repos.openFolder')}>
          {t('gesture.repos.openFolder')}
        </Button>
      }
    />
  );

  const all: ReactNode = listError ? (
    <div className={styles.centered}>
      <GitErrorPanel error={listError} fixes={{ retry: () => void actions.load() }} />
    </div>
  ) : repositories === null ? (
    <div className={styles.skeletons} role="status" aria-label={t('repositories.loading')}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} className={styles.skeleton} style={{ height: rowHeight }} />
      ))}
    </div>
  ) : (
    <VirtualList
      className={styles.list}
      items={visible}
      getKey={getKey}
      label={t('repositories.list.label')}
      rowHeight={rowHeight}
      selectionMode="multiple"
      selected={selectedIds}
      onSelectedChange={pickFrom(ALL_ORIGIN)}
      onActivate={activate}
      empty={empty}
      renderRow={row(ALL_ORIGIN)}
      scrollParent={panelScrollRef}
    />
  );

  return (
    <div className={styles.view} aria-busy={batchBusy}>
      <SplitPane
        label={t('repositories.split')}
        storageId="repositories.split"
        defaultRatio={0.42}
        minFirst={320}
        minSecond={360}
        first={
          <div className={styles.left} onClick={clearOnDeadSpace}>
            <RepoActionsBar />
            <RepoFilterBar
              filter={filter}
              onFilterChange={setFilter}
              sort={sort}
              onSortChange={(next: RepoSort) => actions.setSort(next)}
              layout={layout}
              onLayoutChange={actions.setLayout}
              shown={visible.length}
              total={repositories?.length ?? 0}
            />
            {layout === 'list' && dragging?.kind === 'repo' && library && (
              <SpaceDropTargets
                spaces={library.spaces}
                alreadyIn={draggedMemberships}
                over={dragOver}
                onDragOver={setDragOver}
                onDragLeave={() => setDragOver(null)}
                onDrop={(target) => {
                  if (target === CREATE_SPACE_TARGET) {
                    openDialog({ kind: 'createSpace', repo: dragging.repo });
                  } else {
                    const space = library.spaces.find((candidate) => candidate.id === target);
                    if (space) actions.moveRepoToSpace(space, dragging.repo, dragging.from, true);
                  }
                  setDragging(null);
                }}
              />
            )}
            <div className={styles.scrollArea} ref={panelScrollRef}>
              {layout === 'spaces' && library ? (
                <div className={styles.sections}>
                  <SpacesSection
                    spaces={library.spaces}
                    repositories={visible}
                    avatarOf={avatarOf}
                    selected={selectedIds}
                    menuFor={rowMenuFor}
                    onSelectedChange={(next, space) => selectMany(next, spaceOrigin(space))}
                    onContextSelect={(repo, space) => contextPick(repo, spaceOrigin(space))}
                    onOpen={activate}
                    onOpenAll={actions.openAll}
                    onToggleCollapsed={(space: Space) =>
                      actions.setSpaceCollapsed(space.id, space.collapsed !== true)
                    }
                    currentSpace={currentSpace}
                    renaming={renaming}
                    spaceMenu={spaceMenuFor}
                    onSelectSpace={(space) => actions.setView({ kind: 'space', id: space.id })}
                    onRename={actions.renameSpace}
                    onRenameCancel={() => setRenaming(null)}
                    onDelete={(space) => openDialog({ kind: 'deleteSpace', space })}
                    onCreate={() => openDialog({ kind: 'createSpace' })}
                    dragging={dragging}
                    dragOver={dragOver}
                    onSpaceDragStart={(space) => {
                      actions.setView({ kind: 'space', id: space.id });
                      setDragging({ kind: 'space', space: space.id });
                    }}
                    onRepoDragStart={(repo, from) => setDragging({ kind: 'repo', repo, from })}
                    onDragOver={setDragOver}
                    onDragEnd={() => setDragging(null)}
                    onDrop={(space, index) => {
                      if (dragging?.kind === 'space') {
                        const moved = library.spaces.find((item) => item.id === dragging.space);
                        if (moved) actions.moveSpace(moved, index);
                      } else if (dragging?.kind === 'repo') {
                        actions.moveRepoToSpace(space, dragging.repo, dragging.from);
                      }
                      setDragging(null);
                    }}
                  />
                </div>
              ) : !filtering ? (
                <div className={styles.sections}>
                  <RepoSection
                    id={RECENT_SECTION_ID}
                    title={t('repositories.section.recent')}
                    count={recent.length}
                  >
                    {recent.length === 0 ? (
                      <p className={styles.hint}>{t('repositories.empty.recent.title')}</p>
                    ) : (
                      <div className={styles.recent} style={{ height: recent.length * rowHeight }}>
                        <VirtualList
                          items={recent}
                          getKey={getKey}
                          label={t('repositories.recent.label')}
                          rowHeight={rowHeight}
                          selectionMode="multiple"
                          selected={selectedIds}
                          onSelectedChange={pickFrom(RECENT_ORIGIN)}
                          onActivate={activate}
                          renderRow={row(RECENT_ORIGIN)}
                        />
                      </div>
                    )}
                  </RepoSection>
                </div>
              ) : null}
              <RepoSection
                id={ALL_SECTION_ID}
                title={t(filtering ? 'repositories.section.results' : 'repositories.section.all')}
                count={visible.length}
              >
                <ContextMenu
                  items={panelMenu(gestures)}
                  label={t('repositories.list.panelMenu')}
                  className={styles.listRegion}
                >
                  {all}
                </ContextMenu>
              </RepoSection>
            </div>
          </div>
        }
        second={
          <div className={styles.detail}>
            {batchFailures.length > 0 ? (
              <section
                className={styles.batchResults}
                aria-label={t('repositories.failures.title', { count: batchFailures.length })}
              >
                <h2>{t('repositories.failures.title', { count: batchFailures.length })}</h2>
                <div className={styles.resultActions}>
                  <Button
                    size="sm"
                    disabled={batchBusy}
                    onClick={() => {
                      const repos = batchFailures.map((failure) => failure.repo);
                      if (batchFailures[0]?.operation === 'forget') actions.forgetMany(repos);
                      else actions.openMany(repos);
                    }}
                  >
                    {t('errorFix.retry')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setBatchFailures([])}>
                    {t('repositories.failures.close')}
                  </Button>
                </div>
                <ul className={styles.failureList} aria-label={t('repositories.failures.list')}>
                  {batchFailures.map(({ repo, error }) => (
                    <li key={repo.id}>
                      <h3>{repo.name}</h3>
                      <code className={styles.failurePath}>{repo.path}</code>
                      <GitErrorPanel error={error} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : openError && selected ? (
              <div className={styles.centered}>
                <GitErrorPanel
                  error={openError}
                  fixes={{
                    retry: () => actions.open(selected),
                    locateRepo: () => actions.locate(selected),
                    forgetRepo: () => openDialog({ kind: 'forget', repo: selected }),
                  }}
                />
              </div>
            ) : selectedRepos.length > 1 ? (
              <div className={styles.centered}>
                <EmptyState
                  title={t('repositories.selection.count', { count: selectedRepos.length })}
                  description={t('repositories.selection.description')}
                />
              </div>
            ) : selected ? (
              <RepoStatsPanel key={selected.id} repo={selected} />
            ) : (
              <HomePanel repositories={repositories} library={library} />
            )}
          </div>
        }
      />

      <ForgetRepoDialog
        repo={dialog.kind === 'forget' ? dialog.repo : null}
        repos={dialog.kind === 'forgetMany' ? dialog.repos : undefined}
        onCancel={closeDialog}
        onConfirm={() => {
          if (dialog.kind === 'forgetMany') {
            closeDialog();
            actions.forgetMany(dialog.repos);
            return;
          }
          if (dialog.kind !== 'forget') return;
          closeDialog();
          actions.forget(dialog.repo, nextSelection(visible, dialog.repo.id));
        }}
      />
      <OpenRepoFlow
        error={folderError}
        onClose={() => setFolderError(null)}
        onChooseAnother={actions.openFolder}
        onCreateHere={(path) => openDialog({ kind: 'create', parentPath: path })}
      />
      {dialog.kind === 'create' && (
        <CreateRepoDialog parentPath={dialog.parentPath} actions={actions} onClose={closeDialog} />
      )}
      {dialog.kind === 'clone' && <CloneRepoDialog actions={actions} onClose={closeDialog} />}
      {dialog.kind === 'avatar' && (
        <RepoAvatarDialog
          repo={dialog.repo}
          current={avatarOf(dialog.repo.id)}
          onCancel={closeDialog}
          onConfirm={(avatar) => actions.setAvatar(dialog.repo, avatar)}
        />
      )}
      {dialog.kind === 'createSpace' && library && (
        <SpaceNameDialog
          spaces={library.spaces}
          onCancel={closeDialog}
          onConfirm={(name) =>
            dialog.repo ? actions.createSpaceAndAdd(name, dialog.repo) : actions.createSpace(name)
          }
        />
      )}
      {dialog.kind === 'deleteSpace' && (
        <DeleteSpaceDialog
          space={dialog.space}
          count={
            dialog.space.repos.filter((id) => repositories?.some((repo) => repo.id === id)).length
          }
          onCancel={closeDialog}
          onConfirm={() => actions.deleteSpace(dialog.space)}
        />
      )}
    </div>
  );
}

function shortcutFrom(gestures: GestureRegistry, id: string) {
  const label = gestures.get(id)?.shortcutLabel;
  return label ? { shortcut: label } : {};
}

function rowMenu({
  repo,
  targets,
  busy,
  spaces,
  t,
  gestures,
  actions,
  openDialog,
}: {
  repo: RepoSummary;
  targets: readonly RepoSummary[];
  busy: boolean;
  spaces: readonly Space[];
  t: I18nContextValue['t'];
  gestures: GestureRegistry;
  actions: RepositoryActions;
  openDialog: (dialog: RepositoriesDialog) => void;
}): readonly MenuEntry[] {
  if (targets.length > 1) {
    return [
      {
        key: 'open-selected',
        label: t('repositories.menu.openSelected', { count: targets.length }),
        disabled: busy,
        onSelect: () => actions.openMany(targets),
      },
      { kind: 'separator', key: 'before-forget-selected' },
      {
        key: 'forget-selected',
        label: t('repositories.menu.forgetSelected', { count: targets.length }),
        danger: true,
        disabled: busy,
        onSelect: () => openDialog({ kind: 'forgetMany', repos: targets }),
      },
    ];
  }
  const membership = new Set(
    spaces.filter((space) => space.repos.includes(repo.id)).map((space) => space.id),
  );
  return [
    { key: 'open', label: t('repositories.menu.open'), onSelect: () => actions.open(repo) },
    {
      key: 'reveal',
      label: t('repositories.menu.reveal'),
      ...shortcutFrom(gestures, 'repos.reveal'),
      onSelect: () => actions.reveal(repo),
    },
    {
      key: 'avatar',
      label: t('repositories.menu.chooseAvatar'),
      onSelect: () => openDialog({ kind: 'avatar', repo }),
    },
    ...(spaces.length === 0
      ? []
      : [
          {
            kind: 'submenu' as const,
            key: 'spaces',
            label: t('repositories.menu.moveToSpace'),
            items: spaces.map((space) => ({
              key: space.id,
              label: space.name,
              disabled: membership.has(space.id),
              onSelect: () => actions.addToSpace(space, repo),
            })),
          },
        ]),
    { kind: 'separator', key: 'before-forget' },
    {
      key: 'forget',
      label: t('repositories.menu.forget'),
      danger: true,
      ...shortcutFrom(gestures, 'repos.forget'),
      onSelect: () => openDialog({ kind: 'forget', repo }),
    },
  ];
}

function panelMenu(gestures: GestureRegistry): readonly MenuEntry[] {
  const selectionActions = ['repos.open', 'repos.forget']
    .filter((id) => gestures.get(id)?.disabled === false)
    .map((id) => entryOf(gestures, id));

  return [
    ...selectionActions,
    ...(selectionActions.length > 0
      ? [{ kind: 'separator' as const, key: 'after-selection' }]
      : []),
    entryOf(gestures, 'repos.openFolder'),
    entryOf(gestures, 'repos.create'),
    entryOf(gestures, 'repos.clone'),
    { kind: 'separator', key: 'after-create' },
    entryOf(gestures, 'repos.viewRecent'),
    entryOf(gestures, 'repos.viewAll'),
    { kind: 'separator', key: 'after-views' },
    entryOf(gestures, 'repos.focusFilter'),
  ];
}

function entryOf(gestures: GestureRegistry, id: string): MenuEntry {
  const gesture = gestures.get(id);
  return {
    key: id,
    label: gesture?.label ?? id,
    ...(gesture?.shortcutLabel ? { shortcut: gesture.shortcutLabel } : {}),
    ...(gesture?.disabled ? { disabled: true } : {}),
    onSelect: () => gestures.run(id),
  };
}
