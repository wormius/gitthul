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
  canOpenOnClick?: boolean;
  dragCount?: number;
  menu: readonly MenuEntry[];
  onOpen: () => void;
  onSelect: (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => void;
  onContextSelect?: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/** Tarjeta reconocible de un repositorio dentro de un Espacio. */
export function RepoCard({
  repo,
  avatar,
  selected,
  canOpenOnClick = true,
  dragCount = 1,
  menu,
  onOpen,
  onSelect,
  onContextSelect,
  onDragStart,
  onDragEnd,
}: RepoCardProps) {
  const { t } = useI18n();
  const wasSelected = useRef(false);
  const dragged = useRef(false);
  const dragPreview = useRef<HTMLDivElement>(null);

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    dragged.current = false;
    wasSelected.current =
      event.button === 0 &&
      selected &&
      canOpenOnClick &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey;
  };
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (dragged.current || event.detail !== 1) return;
    const open = wasSelected.current && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    wasSelected.current = false;
    if (open) {
      onOpen();
    } else {
      onSelect(event);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      if (onContextSelect) onContextSelect();
      else onSelect(event);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Enter' && selected) onOpen();
    else onSelect(event);
  };
  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    event.stopPropagation();
    wasSelected.current = false;
    dragged.current = true;
    event.dataTransfer?.setData('text/plain', repo.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = dragCount > 1 ? 'copy' : 'move';
    previewDrag(event, dragPreview.current);
    onDragStart();
  };

  return (
    <ContextMenu
      items={menu}
      label={t('repositories.list.menu', { repo: repo.name })}
      role="presentation"
    >
      <div
        role="option"
        aria-selected={selected}
        data-repo-id={repo.id}
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
        onContextMenu={(event) => {
          if (onContextSelect) onContextSelect();
          else onSelect(event);
        }}
        onKeyDown={onKeyDown}
      >
        <RepoDragPreview ref={dragPreview} repo={repo} avatar={avatar} count={dragCount} />
        <div className={styles.region}>
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
        </div>
      </div>
    </ContextMenu>
  );
}
