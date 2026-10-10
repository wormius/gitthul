import { useI18n } from '@i18n/useI18n';
import { ContextMenu } from '@ui/ContextMenu';
import { useDragSource, useDropTarget, type DropVerdict } from '@ui/dragLayerUtils';
import type { MenuEntry } from '@ui/menuUtils';

import { isDragRef, type DragRef } from './integration';
import { RefIcon, type RefIconKind } from './RefIcon';
import styles from './RefRow.module.css';

interface RefRowProps {
  kind: RefIconKind;
  label: string;
  /** Solo tiene sentido en una local con remota de seguimiento — CU-3. */
  ahead?: number;
  behind?: number;
  /** El menú contextual de la fila, cuando su tipo tiene uno. */
  menu?: readonly MenuEntry[];
  menuLabel?: string;
  /** Doble clic: cambiar a la rama, abrir el worktree — CU-3 y CU-8. */
  onActivate?: () => void;
  /**
   * Clic simple: señalar la fila — CU-3.
   *
   * Es lo que da objeto a los gestos de `checkout`, borrar rama y borrar tag:
   * `run()` no lleva parámetros, así que lo señalado tiene que estar en el
   * store. El doble clic sigue activando, que es otro gesto.
   */
  onSelect?: () => void;
  selected?: boolean;
  /** Si está presente, la fila es arrastrable y destino de suelta — F2.7. */
  drag?: DragRef;
  /** Callback al recibir una suelta válida — F2.7. */
  onDrop?: (source: DragRef) => void;
  /** Color de grafo (1..8) para pintar el icono con el color de su calle. */
  colorIndex?: number;
  /** La fila vive dentro de un Tree, que ya pinta el fondo de hover exterior. */
  nestedInTree?: boolean;
  className?: string;
}

/**
 * Una fila del panel de referencias: icono, nombre y `↑N ↓N` cuando aplique.
 *
 * Desde F2.4 lleva su menú contextual —el camino por defecto de casi cualquier
 * acción, invariante 3— y el doble clic de activación cuando su tipo lo tiene.
 * Desde F2.7 es arrastrable y destino de suelta cuando `drag` está presente.
 */
export function RefRow({
  kind,
  label,
  ahead,
  behind,
  menu,
  menuLabel,
  onActivate,
  onSelect,
  selected = false,
  drag,
  onDrop,
  colorIndex,
  nestedInTree = false,
  className,
}: RefRowProps) {
  const { t } = useI18n();
  const hasAhead = (ahead ?? 0) > 0;
  const hasBehind = (behind ?? 0) > 0;

  const iconStyle =
    colorIndex !== undefined
      ? ({ color: `var(--graph-branch-${String(colorIndex)})` } as React.CSSProperties)
      : undefined;

  const tracking = (hasAhead || hasBehind) && (
    <span
      className={styles.tracking}
      aria-label={t('working.refRow.tracking', { ahead: ahead ?? 0, behind: behind ?? 0 })}
    >
      {hasAhead && `↑${String(ahead)}`}
      {hasAhead && hasBehind && ' '}
      {hasBehind && `↓${String(behind)}`}
    </span>
  );

  // Sin arrastre: la fila estática de siempre.
  if (drag === undefined) {
    const row = (
      <div
        className={[styles.row, className].filter(Boolean).join(' ')}
        data-active={kind === 'activeBranch' ? 'true' : undefined}
        data-selected={selected ? '' : undefined}
        data-nested-in-tree={nestedInTree ? '' : undefined}
        onMouseDown={(event) => {
          if (nestedInTree) return;
          // Solo el clic izquierdo señala, como en `VirtualList` y en `Tree`:
          // el derecho abre el menú sin mover lo que estaba marcado.
          if (event.button === 0) onSelect?.();
        }}
        onDoubleClick={nestedInTree ? undefined : onActivate}
      >
        <RefIcon kind={kind} className={styles.icon} style={iconStyle} />
        <span className={styles.label}>{label}</span>
        {tracking}
      </div>
    );

    if (menu === undefined || menuLabel === undefined) return row;

    return (
      <ContextMenu items={menu} label={menuLabel} className={styles.region}>
        {row}
      </ContextMenu>
    );
  }

  // Con arrastre: la fila es origen y destino de suelta.
  return (
    <DraggableRow
      kind={kind}
      label={label}
      tracking={tracking}
      menu={menu}
      menuLabel={menuLabel}
      onActivate={onActivate}
      onSelect={onSelect}
      selected={selected}
      drag={drag}
      onDrop={onDrop}
      iconStyle={iconStyle}
      nestedInTree={nestedInTree}
      className={className}
    />
  );
}

/**
 * La fila con arrastre. Vive aparte para que `useDragSource` y `useDropTarget`
 * solo se invoquen cuando `DragLayer` existe en el árbol — F2.7.
 */
function DraggableRow({
  kind,
  label,
  tracking,
  menu,
  menuLabel,
  onActivate,
  onSelect,
  selected,
  drag,
  onDrop,
  iconStyle,
  nestedInTree,
  className,
}: {
  kind: RefIconKind;
  label: string;
  tracking: React.ReactNode;
  menu?: readonly MenuEntry[];
  menuLabel?: string;
  onActivate?: () => void;
  onSelect?: () => void;
  selected: boolean;
  drag: DragRef;
  onDrop?: (source: DragRef) => void;
  iconStyle?: React.CSSProperties;
  nestedInTree: boolean;
  className?: string;
}) {
  const dragProps = useDragSource({
    payload: drag,
    text: drag.name,
    className: styles.row,
  });

  const dropProps = useDropTarget({
    accepts: (payload): DropVerdict | null => {
      if (!isDragRef(payload)) return null;
      if (payload.kind === drag.kind && payload.name === drag.name) return null;

      return 'valid';
    },
    onDrop: (payload) => {
      if (isDragRef(payload)) onDrop?.(payload);
    },
    className: '',
  });

  const row = (
    <div
      className={[dragProps.className, dropProps.className, className].filter(Boolean).join(' ')}
      data-active={kind === 'activeBranch' ? 'true' : undefined}
      data-selected={selected ? '' : undefined}
      data-nested-in-tree={nestedInTree ? '' : undefined}
      data-ghost={dragProps['data-ghost']}
      data-drop={dropProps['data-drop']}
      data-over={dropProps['data-over']}
      draggable
      onDragStart={dragProps.onDragStart}
      onDragEnd={dragProps.onDragEnd}
      onDragEnter={dropProps.onDragEnter}
      onDragOver={dropProps.onDragOver}
      onDragLeave={dropProps.onDragLeave}
      onDrop={dropProps.onDrop}
      onMouseDown={(event) => {
        if (nestedInTree) return;
        if (event.button === 0) onSelect?.();
      }}
      onDoubleClick={nestedInTree ? undefined : onActivate}
    >
      <RefIcon kind={kind} className={styles.icon} style={iconStyle} />
      <span className={styles.label}>{label}</span>
      {tracking}
    </div>
  );

  if (menu === undefined || menuLabel === undefined) return row;

  return (
    <ContextMenu items={menu} label={menuLabel} className={styles.region}>
      {row}
    </ContextMenu>
  );
}
