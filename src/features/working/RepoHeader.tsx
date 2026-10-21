import { useState } from 'react';

import { usePorts } from '@app/PortsContext';
import { RepoAliasDialog } from '@app/RepoAliasDialog';
import { useRepositoriesStore } from '@features/repositories/repositoriesStore';
import { useRepositoryName } from '@features/repositories/useRepositoryName';
import { RepoAvatarDialog } from '@app/RepoAvatarDialog';
import { useShellStore } from '@app/shellStore';
import { shortSha } from '@core/domain/commit';
import type { Head } from '@core/domain/refs';
import type { Repository } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Avatar } from '@ui/Avatar';
import { ContextMenu } from '@ui/ContextMenu';
import type { MenuEntry } from '@ui/menuUtils';

import { RefIcon } from './RefIcon';
import styles from './RepoHeader.module.css';
import { useRepoAvatar } from './useRepoAvatar';

interface RepoHeaderProps {
  repository: Repository;
  head: Head;
  /** CU-3: pulsarla lleva el foco a su nodo en el grafo. */
  onGoToHead: () => void;
  collapsed?: boolean;
  onToggle: () => void;
  onCopy: (text: string) => void;
}

/**
 * Nombre del repositorio y rama activa, encima de `RefPanel`.
 *
 * Lleva el avatar del repositorio a la izquierda — el que el usuario eligió en
 * Repositorios, o las iniciales del nombre cuando no hay ninguno elegido.
 * Pulsar la rama lleva la tabla hasta su nodo — CU-3.
 */
export function RepoHeader({
  repository,
  head,
  onGoToHead,
  onCopy,
  collapsed = false,
  onToggle,
}: RepoHeaderProps) {
  const { t } = useI18n();
  const name = useRepositoryName(repository.id, repository.name);
  const alias = useRepositoriesStore((state) => state.library?.aliases[repository.id] ?? null);
  const [choosingAlias, setChoosingAlias] = useState(false);
  const { library } = usePorts();
  const activeId = useShellStore((state) => state.activeId);
  const closeTab = useShellStore((state) => state.closeTab);
  const label = head.detached || head.branch === null ? shortSha(head.sha) : head.branch;
  const avatar = useRepoAvatar(repository.id);
  const [choosingAvatar, setChoosingAvatar] = useState(false);
  const menu: readonly MenuEntry[] = [
    {
      key: 'go-to-head',
      label: t('working.repoHeader.goToHead', { branch: label }),
      onSelect: onGoToHead,
    },
    {
      key: 'copy-name',
      label: t('working.repoHeader.copyName'),
      onSelect: () => onCopy(name),
    },
    {
      key: 'copy-path',
      label: t('working.repoHeader.copyPath'),
      onSelect: () => onCopy(repository.path),
    },
    { kind: 'separator', key: 'appearance' },
    {
      key: 'alias',
      label: t('repositories.alias.menu'),
      onSelect: () => setChoosingAlias(true),
    },
    {
      key: 'avatar',
      label: t('working.repoHeader.changeAvatar'),
      onSelect: () => setChoosingAvatar(true),
    },
    { kind: 'separator', key: 'close-separator' },
    {
      key: 'close',
      label: t('working.repoHeader.close'),
      onSelect: () => {
        if (activeId) closeTab(activeId);
      },
    },
  ];

  return (
    <>
      <ContextMenu
        className={collapsed ? styles.collapsed : undefined}
        items={menu}
        label={t('working.repoHeader.menu', { repo: name })}
      >
        <button
          type="button"
          className={styles.header}
          onClick={onToggle}
          aria-label={`${t(collapsed ? 'working.refPanel.expand' : 'working.refPanel.collapse')}: ${name}`}
          aria-expanded={!collapsed}
        >
          <Avatar
            name={name}
            glyph={avatar?.glyph}
            tone={avatar?.tone}
            color={avatar?.color}
            size={collapsed ? 'xs' : 'md'}
            className={styles.avatar}
          />
          {!collapsed && (
            <span className={styles.info}>
              <span className={styles.name}>{name}</span>
              <span
                className={styles.branch}
                onClick={(event) => {
                  event.stopPropagation();
                  onGoToHead();
                }}
              >
                <RefIcon kind="activeBranch" className={styles.branchIcon} />
                {label}
              </span>
            </span>
          )}
        </button>
      </ContextMenu>

      {choosingAlias && (
        <RepoAliasDialog
          repo={repository}
          current={alias}
          onClose={() => setChoosingAlias(false)}
        />
      )}
      {choosingAvatar && (
        <RepoAvatarDialog
          repo={repository}
          current={avatar}
          onCancel={() => setChoosingAvatar(false)}
          onConfirm={(next) => {
            void library.setAvatar(repository.id, next).then(
              (saved) => {
                useRepositoriesStore.getState().setLibrary(saved);
                setChoosingAvatar(false);
              },
              () => {
                // El puerto conserva el dato anterior; el diálogo queda abierto
                // para que la elección no parezca guardada cuando falló.
              },
            );
          }}
        />
      )}
    </>
  );
}
