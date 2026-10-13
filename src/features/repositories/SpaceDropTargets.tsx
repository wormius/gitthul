import type { DragEvent } from 'react';

import type { Space, SpaceId } from '@core/domain/library';
import { useI18n } from '@i18n/useI18n';

import { SpaceIcon } from './RepositoryIcons';
import styles from './SpaceDropTargets.module.css';

export const CREATE_SPACE_TARGET = 'create';
export type SpaceDropTarget = string;

interface SpaceDropTargetsProps {
  spaces: readonly Space[];
  alreadyIn: ReadonlySet<SpaceId>;
  dropEffect?: 'copy' | 'move';
  over: SpaceDropTarget | null;
  onDragOver: (target: SpaceDropTarget) => void;
  onDragLeave: () => void;
  onDrop: (target: SpaceDropTarget) => void;
}

/** Destinos compactos que aparecen al arrastrar una fila mientras las zonas no están visibles. */
export function SpaceDropTargets({
  spaces,
  alreadyIn,
  dropEffect = 'move',
  over,
  onDragOver,
  onDragLeave,
  onDrop,
}: SpaceDropTargetsProps) {
  const { t } = useI18n();

  const dragOver = (target: SpaceDropTarget) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = dropEffect;
    onDragOver(target);
  };
  const drop = (target: SpaceDropTarget) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    onDrop(target);
  };

  return (
    <div
      className={styles.strip}
      role="group"
      aria-label={t('repositories.dropTargets.label')}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        onDragLeave();
      }}
    >
      {spaces.map((space) => {
        const disabled = alreadyIn.has(space.id);
        return (
          <div
            key={space.id}
            className={styles.card}
            data-over={over === space.id ? '' : undefined}
            data-disabled={disabled ? '' : undefined}
            aria-disabled={disabled}
            onDragOver={disabled ? undefined : dragOver(space.id)}
            onDrop={disabled ? undefined : drop(space.id)}
          >
            <SpaceIcon className={styles.icon} />
            <span className={styles.name}>{space.name}</span>
          </div>
        );
      })}
      <div
        className={styles.card}
        data-create=""
        data-over={over === CREATE_SPACE_TARGET ? '' : undefined}
        onDragOver={dragOver(CREATE_SPACE_TARGET)}
        onDrop={drop(CREATE_SPACE_TARGET)}
      >
        <span className={styles.plus} aria-hidden="true">
          +
        </span>
        <span className={styles.name}>{t('repositories.dropTargets.create')}</span>
      </div>
    </div>
  );
}
