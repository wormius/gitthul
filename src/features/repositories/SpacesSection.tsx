import { useRef, type KeyboardEvent, type MouseEvent } from 'react';

import type { RepoAvatar, Space, SpaceId } from '@core/domain/library';
import type { RepoId, RepoSummary } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import type { MenuEntry } from '@ui/menuUtils';
import { useSelection } from '@ui/selection';

import { RepoCard } from './RepoCard';
import { RepoSection } from './RepoSection';
import { SpaceZone } from './SpaceZone';
import type { RepositoriesDrag } from './repositoriesStore';
import styles from './SpacesSection.module.css';

interface SpacesSectionProps {
  spaces: readonly Space[];
  repositories: readonly RepoSummary[];
  avatarOf: (repo: RepoId) => RepoAvatar | null;
  selected: ReadonlySet<RepoId>;
  menuFor: (repo: RepoSummary) => readonly MenuEntry[];
  onSelectedChange: (next: ReadonlySet<RepoId>, space: SpaceId) => void;
  onContextSelect: (repo: RepoSummary, space: SpaceId) => void;
  onOpen: (repo: RepoSummary) => void;
  onOpenAll: (space: Space, repos: readonly RepoSummary[]) => void;
  onToggleCollapsed: (space: Space) => void;
  currentSpace: SpaceId | null;
  renaming: SpaceId | null;
  spaceMenu: (space: Space, index: number) => readonly MenuEntry[];
  onSelectSpace: (space: Space) => void;
  onRename: (space: Space, name: string) => void;
  onRenameCancel: () => void;
  onDelete: (space: Space) => void;
  onCreate: () => void;
  dragging: RepositoriesDrag | null;
  dragOver: SpaceId | null;
  onSpaceDragStart: (space: Space) => void;
  onRepoDragStart: (repo: RepoSummary, from: SpaceId) => void;
  onDragOver: (id: SpaceId | null) => void;
  onDragEnd: () => void;
  onDrop: (space: Space, index: number) => void;
}

export function SpacesSection({
  spaces,
  repositories,
  avatarOf,
  selected,
  menuFor,
  onSelectedChange,
  onContextSelect,
  onOpen,
  onOpenAll,
  onToggleCollapsed,
  currentSpace,
  renaming,
  spaceMenu,
  onSelectSpace,
  onRename,
  onRenameCancel,
  onDelete,
  onCreate,
  dragging,
  dragOver,
  onSpaceDragStart,
  onRepoDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: SpacesSectionProps) {
  const { t } = useI18n();
  const byId = new Map(repositories.map((repo) => [repo.id, repo]));
  const activeSpace = useRef<SpaceId | null>(null);
  const selection = useSelection('multiple', selected, (next) => {
    if (activeSpace.current !== null) onSelectedChange(next, activeSpace.current);
  });
  const visibleIds = () =>
    [...new Set(spaces.flatMap((space) => (space.collapsed ? [] : space.repos)))].filter((id) =>
      byId.has(id),
    );
  const select = (
    repo: RepoSummary,
    space: SpaceId,
    event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>,
  ) => {
    activeSpace.current = space;
    selection.select(repo.id, visibleIds, event);
  };

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;

    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

    const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];

    if (options.length === 0) return;

    const current = target.closest<HTMLElement>('[role="option"]');
    if (current === null && target !== event.currentTarget) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      const first = current ?? options[0];
      const space = first?.closest<HTMLElement>('[data-space-id]')?.dataset['spaceId'];
      if (space === undefined) return;

      event.preventDefault();
      activeSpace.current = space;
      selection.selectAll(visibleIds);
      return;
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const index = current === null ? -1 : options.indexOf(current);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowUp'
            ? index <= 0
              ? 0
              : index - 1
            : Math.min(index + 1, options.length - 1);

    event.preventDefault();
    const option = options[next];
    const id = option?.dataset['repoId'];
    const space = option?.closest<HTMLElement>('[data-space-id]')?.dataset['spaceId'];
    if (option === undefined || id === undefined || space === undefined) return;

    option.focus({ preventScroll: false });
    activeSpace.current = space;
    selection.select(id, visibleIds, event);
  };

  return (
    <RepoSection
      id="repositories-spaces"
      title={t('repositories.section.spaces')}
      count={spaces.length}
    >
      <div
        className={styles.zones}
        role="group"
        aria-label={t('repositories.section.spaces')}
        tabIndex={0}
        onKeyDown={navigate}
      >
        {spaces.length === 0 && <p className={styles.none}>{t('repositories.spaces.none')}</p>}
        {spaces.map((space) => {
          const members = space.repos.flatMap((id) => {
            const repo = byId.get(id);
            return repo ? [repo] : [];
          });
          return (
            <SpaceZone
              key={space.id}
              space={space}
              members={members}
              avatarOf={avatarOf}
              spaces={spaces}
              current={currentSpace === space.id}
              renaming={renaming === space.id}
              menu={spaceMenu(space, spaces.indexOf(space))}
              onSelect={() => onSelectSpace(space)}
              onRename={(name) => onRename(space, name)}
              onRenameCancel={onRenameCancel}
              onDelete={() => onDelete(space)}
              onOpenAll={() => onOpenAll(space, members)}
              draggable
              ghost={dragging?.kind === 'space' && dragging.space === space.id}
              dropTarget={dragOver === space.id}
              dropEffect={dragging?.kind === 'repo' && dragging.repos.length > 1 ? 'copy' : 'move'}
              onDragStart={() => onSpaceDragStart(space)}
              onDragOver={() => onDragOver(space.id)}
              onDragEnd={onDragEnd}
              onDrop={() => onDrop(space, spaces.indexOf(space))}
              onToggleCollapsed={() => onToggleCollapsed(space)}
            >
              {members.map((repo) => (
                <RepoCard
                  key={repo.id}
                  repo={repo}
                  avatar={avatarOf(repo.id)}
                  selected={selected.has(repo.id)}
                  canOpenOnClick={selected.size === 1}
                  dragCount={selected.has(repo.id) ? selected.size : 1}
                  menu={menuFor(repo)}
                  onSelect={(event) => select(repo, space.id, event)}
                  onContextSelect={() => onContextSelect(repo, space.id)}
                  onOpen={() => onOpen(repo)}
                  onDragStart={() => onRepoDragStart(repo, space.id)}
                  onDragEnd={onDragEnd}
                />
              ))}
            </SpaceZone>
          );
        })}
        <Button className={styles.create} onClick={onCreate}>
          {t('repositories.spaces.create.button')}
        </Button>
      </div>
    </RepoSection>
  );
}
