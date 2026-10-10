import { useRef, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';

import { BranchIcon, WorktreeIcon } from '@app/ShellIcons';
import type { RepoAvatar } from '@core/domain/library';
import type { RepoSummary } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Avatar } from '@ui/Avatar';
import { ContextMenu } from '@ui/ContextMenu';
import { previewDrag } from '@ui/dragPreview';
import type { MenuEntry } from '@ui/menuUtils';

import { RepoDragPreview } from './RepoDragPreview';
import styles from './RepoCard.module.css';

interface RepoCardProps {
  repo: RepoSummary;
  avatar: RepoAvatar | null;
  selected: boolean;
  menu: readonly MenuEntry[];
  onOpen: () => void;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/** Tarjeta reconocible de un repositorio dentro de un Espacio. */
export function RepoCard({
  repo,
  avatar,
  selected,
  menu,
  onOpen,
  onSelect,
  onDragStart,
  onDragEnd,
}: RepoCardProps) {
  const { t } = useI18n();
  const wasSelected = useRef(false);
  const dragPreview = useRef<HTMLDivElement>(null);

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    wasSelected.current = event.button === 0 && selected;
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.detail !== 1) return;
    if (wasSelected.current) {
      wasSelected.current = false;
      onOpen();
    } else {
      onSelect();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (selected) onOpen();
    else onSelect();
  };
  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.dataTransfer?.setData('text/plain', repo.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    previewDrag(event, dragPreview.current);
    onDragStart();
  };

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={styles.card}
      draggable
      onDragStart={startDrag}
      onDragEnd={(event) => {
        event.stopPropagation();
        onDragEnd();
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onContextMenu={onSelect}
      onKeyDown={onKeyDown}
    >
      <RepoDragPreview ref={dragPreview} repo={repo} avatar={avatar} />
      <ContextMenu
        items={menu}
        label={t('repositories.list.menu', { repo: repo.name })}
        className={styles.region}
      >
        <Avatar
          name={repo.name}
          email={repo.id}
          size="md"
          className={styles.avatar}
          {...(avatar === null ? {} : avatar)}
        />
        <span className={styles.body}>
          <span className={styles.name}>{repo.name}</span>
          <span className={styles.path}>{repo.path}</span>
          <span className={styles.meta}>
            <BranchIcon className={styles.icon} />
            {t('repositories.row.branch', { branch: repo.head })}
          </span>
          {repo.worktreeOf !== undefined && (
            <span className={styles.meta}>
              <WorktreeIcon className={styles.icon} />
              {t('repositories.row.worktree', { repo: repo.worktreeOf })}
            </span>
          )}
        </span>
      </ContextMenu>
    </div>
  );
}
