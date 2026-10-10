import { useI18n } from '@i18n/useI18n';
import { useDragSource, useDropTarget, type DropVerdict } from '@ui/dragLayerUtils';

import { isDragRef, type DragRef } from './integration';
import { RefIcon } from './RefIcon';
import type { RefLabelItem } from './refs';
import styles from './RefLabel.module.css';
import { useWorkingStore } from './workingStore';

interface RefLabelProps {
  item: RefLabelItem;
  /** Si está presente, la etiqueta es arrastrable y destino de suelta — F2.7. */
  drag?: DragRef;
  /** Callback al recibir una suelta válida — F2.7. */
  onDrop?: (source: DragRef) => void;
  className?: string;
  onDoubleClick?: () => void;
}

/**
 * La etiqueta de una rama o de un tag sobre el grafo.
 *
 * Una local y su remota coincidentes forman un solo chip con ambos iconos. Una
 * remota sola enseña el nombre corto, pero su `refName` sigue guardando la
 * identidad completa para menús y arrastre. El punto de rama activa se suma a
 * los iconos de tipo; nunca sustituye al local ni aparece en otra rama.
 *
 * Sin cambios de caja al pasar el ratón: la invariante 1 no admite que el hover
 * mueva la fila, así que solo cambian color y sombra interior.
 *
 * Desde F2.7 es arrastrable y destino de suelta cuando `drag` está presente.
 */
export function RefLabel({ item, drag, onDrop, className, onDoubleClick }: RefLabelProps) {
  const { t } = useI18n();
  const refColors = useWorkingStore((state) => state.refColors);

  // El nombre con el que se busca en el mapa: el que `buildGraph` guardó al
  // recorrer `refs.branches` y `refs.tags` — `branch.name` y `tag.name`.
  const colorKey = item.kind === 'tag' ? item.name : (item.local?.name ?? item.remote?.name);
  const colorIndex = colorKey !== undefined ? refColors.get(colorKey) : undefined;
  const branchStyle =
    colorIndex !== undefined
      ? ({ '--ref-color': `var(--graph-branch-${String(colorIndex)})` } as React.CSSProperties)
      : undefined;

  const kindLabel =
    item.kind === 'tag'
      ? t('working.refLabel.tag', { name: item.name })
      : item.isHead
        ? t('working.refLabel.activeBranch', { name: item.name })
        : item.local && item.remote
          ? t('working.refLabel.tracked', { name: item.name })
          : item.remote
            ? t('working.refLabel.remote', { name: item.name })
            : t('working.refLabel.local', { name: item.name });

  const icons = (
    <span className={styles.icons} aria-hidden="true">
      {item.kind === 'tag' ? (
        <RefIcon kind="tag" className={styles.icon} />
      ) : (
        <>
          {item.isHead && <RefIcon kind="activeBranch" className={styles.icon} />}
          {item.local && <RefIcon kind="local" className={styles.icon} />}
          {item.remote && <RefIcon kind="remote" className={styles.icon} />}
        </>
      )}
    </span>
  );

  // Sin arrastre: la etiqueta estática de siempre.
  if (drag === undefined) {
    return (
      <span
        className={[styles.label, item.isHead ? styles.head : '', className]
          .filter(Boolean)
          .join(' ')}
        title={kindLabel}
        data-kind={item.kind}
        style={branchStyle}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onDoubleClick?.();
        }}
      >
        {icons}
        <span className={styles.name}>{item.name}</span>
      </span>
    );
  }

  return (
    <DraggableLabel
      item={item}
      kindLabel={kindLabel}
      icons={icons}
      drag={drag}
      onDrop={onDrop}
      className={className}
      style={branchStyle}
      onDoubleClick={onDoubleClick}
    />
  );
}

/**
 * La etiqueta con arrastre. Vive aparte para que los hooks de `DragLayer`
 * solo se invoquen cuando el contexto existe — F2.7.
 */
function DraggableLabel({
  item,
  kindLabel,
  icons,
  drag,
  onDrop,
  className,
  style,
  onDoubleClick,
}: {
  item: RefLabelItem;
  kindLabel: string;
  icons: React.ReactNode;
  drag: DragRef;
  onDrop?: (source: DragRef) => void;
  className?: string;
  style?: React.CSSProperties;
  onDoubleClick?: () => void;
}) {
  const dragProps = useDragSource({
    payload: drag,
    text: drag.name,
    className: styles.label,
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

  return (
    <span
      className={[
        dragProps.className,
        dropProps.className,
        item.isHead ? styles.head : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      title={kindLabel}
      data-kind={item.kind}
      data-ghost={dragProps['data-ghost']}
      data-drop={dropProps['data-drop']}
      data-over={dropProps['data-over']}
      style={style}
      draggable
      onDragStart={dragProps.onDragStart}
      onDragEnd={dragProps.onDragEnd}
      onDragEnter={dropProps.onDragEnter}
      onDragOver={dropProps.onDragOver}
      onDragLeave={dropProps.onDragLeave}
      onDrop={dropProps.onDrop}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick?.();
      }}
    >
      {icons}
      <span className={styles.name}>{item.name}</span>
    </span>
  );
}
