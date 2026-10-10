import type { KeyboardEvent } from 'react';

import type { RepoAvatar, Space, SpaceId } from '@core/domain/library';
import type { RepoId, RepoSummary } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import type { MenuEntry } from '@ui/menu';

import { RepoCard } from './RepoCard';
import { RepoSection } from './RepoSection';
import { SpaceZone } from './SpaceZone';
import type { RepositoriesDrag } from './repositoriesStore';
import styles from './SpacesSection.module.css';

interface SpacesSectionProps {
  spaces: readonly Space[];
  repositories: readonly RepoSummary[];
  avatarOf: (repo: RepoId) => RepoAvatar | null;
  selected: RepoId | null;
  selectedIn: string;
  menuFor: (repo: RepoSummary) => readonly MenuEntry[];
  onSelect: (repo: RepoSummary, space: SpaceId) => void;
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
  selectedIn,
  menuFor,
  onSelect,
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

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];

    if (options.length === 0) return;

    const current = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]');
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
    options[next]?.focus({ preventScroll: false });
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
          const origin = `space:${space.id}`;
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
                  selected={selected === repo.id && selectedIn === origin}
                  menu={menuFor(repo)}
                  onSelect={() => onSelect(repo, space.id)}
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
