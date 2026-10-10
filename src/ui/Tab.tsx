import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react';

import { ContextMenu } from './ContextMenu';
import { IconButton } from './IconButton';
import type { MenuEntry } from './menuUtils';
import styles from './Tab.module.css';

export interface TabDescriptor {
  id: string;
  label: string;
  /** Texto atenuado detrás del rótulo: la rama, el worktree, el modo. */
  hint?: string;
  icon?: ReactNode;
  /** Etiqueta accesible del cierre; nombra la pestaña. */
  closeLabel: string;
  /** Menú contextual específico de esta pestaña. */
  menu?: {
    label: string;
    description?: string;
    items: readonly MenuEntry[];
  };
}

interface TabProps {
  tab: TabDescriptor;
  active: boolean;
  /** Es la pestaña que se está arrastrando: se queda fantasmal en su hueco. */
  dragging?: boolean;
  /** Se va a soltar aquí lo que se está arrastrando. */
  dropTarget?: boolean;
  onActivate: () => void;
  onClose: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLLIElement>) => void;
  ref?: Ref<HTMLButtonElement>;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.4 3.4 8.6 8.6M8.6 3.4 3.4 8.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Una pestaña de la tira.
 *
 * La `×` está siempre visible. Las transformaciones de superficie viven en
 * los accesos generales y atajos del shell, no como botones efímeros dentro de
 * cada pestaña.
 *
 * El clic con la rueda cierra, como en cualquier navegador, y es el segundo
 * gesto de cerrar que pide la invariante 3 junto a la `×` y al atajo.
 */
export function Tab({
  tab,
  active,
  dragging,
  dropTarget,
  onActivate,
  onClose,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onKeyDown,
  ref,
}: TabProps) {
  const startDrag = (event: DragEvent<HTMLLIElement>) => {
    // El identificador viaja también en el evento para que el navegador muestre
    // el arrastre; quien reordena lo lee del estado de la tira.
    event.dataTransfer?.setData('text/plain', tab.id);

    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';

    onDragStart();
  };

  const dragOver = (event: DragEvent<HTMLLIElement>) => {
    // Sin esto el navegador rechaza el soltar y no hay reordenación posible.
    event.preventDefault();

    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    onDragOver();
  };

  const drop = (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    onDrop();
  };

  const auxClick = (event: MouseEvent<HTMLLIElement>) => {
    if (event.button !== 1) return;

    event.preventDefault();
    onClose();
  };

  return (
    <li
      className={styles.tab}
      data-active={active}
      data-dragging={dragging === true}
      data-drop-target={dropTarget === true}
      draggable
      onDragStart={startDrag}
      onDragOver={dragOver}
      onDragEnd={onDragEnd}
      onDrop={drop}
      onAuxClick={auxClick}
      onKeyDown={onKeyDown}
    >
      <ContextMenu
        items={tab.menu?.items ?? []}
        label={tab.menu?.label ?? tab.label}
        description={tab.menu?.description}
        className={styles.menuRegion}
      >
        <button
          ref={ref}
          type="button"
          className={styles.activate}
          aria-current={active ? 'page' : undefined}
          onClick={onActivate}
        >
          {tab.icon && (
            <span className={styles.icon} aria-hidden="true">
              {tab.icon}
            </span>
          )}
          <span className={styles.label}>{tab.label}</span>
          {tab.hint && <span className={styles.hint}>{tab.hint}</span>}
        </button>

        <IconButton
          size="sm"
          className={styles.close}
          icon={<CloseIcon />}
          aria-label={tab.closeLabel}
          onClick={onClose}
        />
      </ContextMenu>
    </li>
  );
}
