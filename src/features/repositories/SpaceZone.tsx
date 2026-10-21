import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';

import { repositoryName, type RepoAvatar, type Space } from '@core/domain/library';
import type { RepoId, RepoSummary } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Avatar } from '@ui/Avatar';
import { ContextMenu } from '@ui/ContextMenu';
import { IconButton } from '@ui/IconButton';
import { Input } from '@ui/Input';
import type { MenuEntry } from '@ui/menuUtils';

import { validateSpaceName } from './collection';
import { OpenAllIcon, SpaceIcon, TrashIcon } from './RepositoryIcons';
import { useRepositoriesStore } from './repositoriesStore';
import styles from './SpaceZone.module.css';

interface SpaceZoneProps {
  space: Space;
  members: readonly RepoSummary[];
  avatarOf: (repo: RepoId) => RepoAvatar | null;
  spaces: readonly Space[];
  current: boolean;
  renaming: boolean;
  menu: readonly MenuEntry[];
  onSelect: () => void;
  onRename: (name: string) => void;
  onRenameCancel: () => void;
  onDelete: () => void;
  onOpenAll: () => void;
  draggable: boolean;
  ghost: boolean;
  dropTarget: boolean;
  dropEffect?: 'copy' | 'move';
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onToggleCollapsed: () => void;
  children: ReactNode;
}

/** Zona persistida de un Espacio; plegada conserva las caras de sus miembros. */
export function SpaceZone({
  space,
  members,
  avatarOf,
  spaces,
  current,
  renaming,
  menu,
  onSelect,
  onRename,
  onRenameCancel,
  onDelete,
  onOpenAll,
  draggable,
  ghost,
  dropTarget,
  dropEffect = 'move',
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onToggleCollapsed,
  children,
}: SpaceZoneProps) {
  const { t } = useI18n();
  const aliases = useRepositoriesStore((state) => state.library?.aliases);
  const collapsed = space.collapsed === true;
  const [draft, setDraft] = useState(space.name);
  const problem = validateSpaceName(spaces, draft, space.id);
  const confirm = () => {
    if (problem === null) onRename(draft);
  };
  const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirm();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(space.name);
      onRenameCancel();
    }
  };
  const startDrag = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer?.setData('text/plain', space.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    onDragStart();
  };
  const dragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffect;
    onDragOver();
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    onDrop();
  };
  return (
    <ContextMenu items={menu} label={t('repositories.spaces.zoneMenu', { space: space.name })}>
      <section
        className={styles.zone}
        data-collapsed={collapsed ? '' : undefined}
        data-current={current ? '' : undefined}
        data-ghost={ghost ? '' : undefined}
        data-drop-target={dropTarget ? '' : undefined}
        aria-label={t('repositories.spaces.zone', { space: space.name })}
        draggable={draggable && !renaming}
        onDragStart={startDrag}
        onDragOver={dragOver}
        onDragEnd={onDragEnd}
        onDrop={drop}
        onClick={onSelect}
      >
        {renaming ? (
          <div className={styles.editing}>
            <span className={styles.icon} aria-hidden="true">
              <SpaceIcon />
            </span>
            <Input
              autoFocus
              label={t('repositories.spaces.renameLabel', { space: space.name })}
              hideLabel
              value={draft}
              error={problem === null ? undefined : t(`repositories.spaces.name.${problem}`)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onFieldKeyDown}
              onBlur={confirm}
            />
          </div>
        ) : (
          <div className={styles.header}>
            <IconButton
              size="sm"
              className={styles.disclosure}
              icon={<span aria-hidden="true">›</span>}
              aria-label={t(
                collapsed ? 'repositories.spaces.expand' : 'repositories.spaces.collapse',
                {
                  space: space.name,
                },
              )}
              aria-expanded={!collapsed}
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapsed();
              }}
            />
            <span className={styles.icon} aria-hidden="true">
              <SpaceIcon />
            </span>
            <span className={styles.name}>{space.name}</span>
            {collapsed && (
              <div className={styles.faces}>
                {members.slice(0, 8).map((repo) => (
                  <Avatar
                    key={repo.id}
                    name={repositoryName(repo, aliases)}
                    email={repo.id}
                    size="sm"
                    {...(avatarOf(repo.id) ?? {})}
                  />
                ))}
                {members.length > 8 && <span className={styles.more}>+{members.length - 8}</span>}
              </div>
            )}
            {!collapsed && (
              <div className={styles.actions}>
                <IconButton
                  size="sm"
                  icon={<OpenAllIcon />}
                  aria-label={t('gesture.repos.openAllSpace', { space: space.name })}
                  title={t('gesture.repos.openAllSpace', { space: space.name })}
                  disabled={members.length === 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenAll();
                  }}
                />
                <IconButton
                  size="sm"
                  icon={<TrashIcon />}
                  aria-label={t('gesture.repos.deleteSpace', { space: space.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete();
                  }}
                />
              </div>
            )}
          </div>
        )}
        {!collapsed &&
          (members.length === 0 ? (
            <p className={styles.empty}>{t('repositories.spaces.empty', { space: space.name })}</p>
          ) : (
            <div
              role="listbox"
              aria-label={t('repositories.spaces.zoneList', { space: space.name })}
              aria-multiselectable="true"
              data-space-id={space.id}
              className={styles.grid}
            >
              {children}
            </div>
          ))}
      </section>
    </ContextMenu>
  );
}
