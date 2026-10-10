import type { Ref } from 'react';

import type { RepoAvatar } from '@core/domain/library';
import type { RepoSummary } from '@core/domain/repository';
import { Avatar } from '@ui/Avatar';

import styles from './RepoDragPreview.module.css';

interface RepoDragPreviewProps {
  ref: Ref<HTMLDivElement>;
  repo: RepoSummary;
  avatar: RepoAvatar | null;
}

/** Copia compacta que acompaña al puntero sin transportar toda la fila o tarjeta. */
export function RepoDragPreview({ ref, repo, avatar }: RepoDragPreviewProps) {
  return (
    <div ref={ref} className={styles.preview} data-name={repo.name} aria-hidden="true">
      <Avatar name={repo.name} email={repo.id} size="sm" {...(avatar ?? {})} />
    </div>
  );
}
