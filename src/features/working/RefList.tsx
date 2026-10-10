import type { ReactNode } from 'react';

import { useDropTarget, type DropVerdict } from '@ui/dragLayer';

import { isDragRef } from './integration';
import styles from './RefList.module.css';

interface RefListProps {
  /** Nombre accesible del grupo de filas. */
  label: string;
  count: number;
  /** Lo que se pinta cuando `count` es cero. */
  empty?: ReactNode;
  /**
   * La sección es destino de suelta para ramas (sección Worktrees) — F2.7.
   * Cuando está presente, acepta solo `DragRef` con `kind: 'branch'`.
   */
  onWorktreeDrop?: (branch: string) => void;
  /**
   * Si `true`, la sección se marca como destino inválido cuando hay un
   * arrastre en curso de una referencia — F2.7.
   */
  invalidDrop?: boolean;
  children: ReactNode;
}

/**
 * Cuerpo de una sección del panel de referencias — las filas que van debajo de
 * la cabecera colapsable de `CollapsibleRail`. Solo se monta cuando la sección
 * está desplegada; la lógica de plegar/desplegar vive arriba.
 *
 * Conserva el soporte de arrastre (worktrees) y el estado vacío.
 */
export function RefList({
  label,
  count,
  empty,
  onWorktreeDrop,
  invalidDrop,
  children,
}: RefListProps) {
  const isDropTarget = onWorktreeDrop !== undefined || invalidDrop === true;

  return (
    <div className={styles.list} role="group" aria-label={label}>
      {isDropTarget && <DropZone onWorktreeDrop={onWorktreeDrop} invalidDrop={invalidDrop} />}
      {count === 0 ? <p className={styles.empty}>{empty}</p> : children}
    </div>
  );
}

/**
 * Zona de suelta invisible que cubre el cuerpo de la sección — solo se monta
 * cuando la sección acepta o rechaza soltar referencias encima.
 */
function DropZone({
  onWorktreeDrop,
  invalidDrop,
}: {
  onWorktreeDrop?: (branch: string) => void;
  invalidDrop?: boolean;
}) {
  const dropProps = useDropTarget({
    accepts: (payload): DropVerdict | null => {
      if (onWorktreeDrop !== undefined) {
        if (!isDragRef(payload)) return null;

        return payload.kind === 'branch' ? 'valid' : 'invalid';
      }

      if (invalidDrop) {
        if (!isDragRef(payload)) return null;

        return 'invalid';
      }

      return null;
    },
    onDrop: (payload) => {
      if (onWorktreeDrop !== undefined && isDragRef(payload) && payload.kind === 'branch') {
        onWorktreeDrop(payload.name);
      }
    },
    className: '',
  });

  return (
    <div
      className={styles.dropZone}
      data-drop={dropProps['data-drop']}
      data-over={dropProps['data-over']}
      onDragEnter={dropProps.onDragEnter}
      onDragOver={dropProps.onDragOver}
      onDragLeave={dropProps.onDragLeave}
      onDrop={dropProps.onDrop}
    />
  );
}
