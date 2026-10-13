import type { Ref } from 'react';

import type { RepoAvatar } from '@core/domain/library';
import type { RepoSummary } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Avatar } from '@ui/Avatar';

import styles from './RepoDragPreview.module.css';

interface RepoDragPreviewProps {
  ref: Ref<HTMLDivElement>;
  repo: RepoSummary;
  avatar: RepoAvatar | null;
  count?: number;
}

/** Copia compacta que acompaña al puntero sin transportar toda la fila o tarjeta. */
export function RepoDragPreview({ ref, repo, avatar, count = 1 }: RepoDragPreviewProps) {
  const { t } = useI18n();
  const label = count > 1 ? t('repositories.drag.multiple', { count }) : repo.name;
  return (
    <div ref={ref} className={styles.preview} data-name={label} aria-hidden="true">
      <Avatar name={repo.name} email={repo.id} size="sm" {...(avatar ?? {})} />
    </div>
  );
}
