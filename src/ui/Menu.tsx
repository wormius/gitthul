import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import type { FloatingAlign, FloatingAnchor, FloatingSide } from './floatingUtils';
import { Floating } from './Floating';
import { Kbd } from './Kbd';
import {
  firstIndex,
  isSeparator,
  isSubmenu,
  lastIndex,
  stepIndex,
  type MenuEntry,
} from './menuUtils';
import styles from './Menu.module.css';
import { useOutsidePointer } from './useOutsidePointer';

/*
 * Los menús abiertos, submenús incluidos. Cada uno vive en su propio portal, de
 * modo que un submenú no está dentro del DOM de su padre: sin este registro,
 * pulsar en un submenú se leería como pulsar fuera y cerraría todo el árbol.
 */
const OPEN_MENUS = new Set<HTMLElement>();

function insideOpenMenu(target: Node): boolean {
  for (const menu of OPEN_MENUS) {
    if (menu.contains(target)) return true;
  }

  return false;
}

interface MenuProps {
  items: readonly MenuEntry[];
  /** Nombre accesible de la lista. */
  label: string;
  /** Sobre qué opera el menú: «3 commits seleccionados». Va arriba, sin ser un ítem. */
  description?: string;
  anchor: FloatingAnchor;
  side?: FloatingSide;
  align?: FloatingAlign;
  matchAnchorWidth?: boolean;
  /** Cierra el árbol completo de menús. */
  onClose: () => void;
  /** Cierra solo esta rama y devuelve el foco al ítem padre. Solo en submenús. */
  onCloseBranch?: () => void;
  /** Lo que abrió el menú: pulsar ahí no cuenta como pulsar fuera. */
  trigger?: HTMLElement | null;
}

/**
 * Lista de menú flotante con submenús, separadores y atajos.
 *
 * No se usa suelta: la montan `ContextMenu`, `Dropdown` y `SplitActionButton`,
 * que son los que deciden dónde se ancla y quién recupera el foco al cerrar.
 * Al abrirse resalta la primera entrada navegable, así el teclado sirve desde
 * el primer instante sin obligar a pulsar una flecha para empezar.
 */
export function Menu({
  items,
  label,
  description,
  anchor,
  side = 'bottom',
  align = 'start',
  matchAnchorWidth = false,
  onClose,
  onCloseBranch,
  trigger,
}: MenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const descriptionId = useId();
  const isBranch = Boolean(onCloseBranch);

  const [activeIndex, setActiveIndex] = useState(() => firstIndex(items));
  // El submenú guarda también su anclaje: se coloca durante el render, y en ese
  // momento las refs de los ítems todavía no se pueden leer.
  const [openSubmenu, setOpenSubmenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);

  useEffect(() => {
    const node = panelRef.current;

    if (!node) return;

    OPEN_MENUS.add(node);

    return () => {
      OPEN_MENUS.delete(node);
    };
  }, []);

  useEffect(() => {
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  // Solo la raíz vigila el exterior: los submenús se cierran con ella.
  useOutsidePointer(
    !isBranch,
    onClose,
    (target) => insideOpenMenu(target) || (trigger?.contains(target) ?? false),
  );

  const focusActive = () => {
    itemRefs.current[activeIndex]?.focus();
  };

  const closeBranch = () => {
    setOpenSubmenu(null);
    focusActive();
  };

  const openSubmenuAt = (key: string, index: number) => {
    const anchor = itemRefs.current[index];

    if (anchor) setOpenSubmenu({ key, anchor });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entry = items[activeIndex];
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    switch (event.key) {
      case 'ArrowDown':
        setActiveIndex(stepIndex(items, activeIndex, 1));

        return handled();
      case 'ArrowUp':
        setActiveIndex(stepIndex(items, activeIndex, -1));

        return handled();
      case 'Home':
        setActiveIndex(firstIndex(items));

        return handled();
      case 'End':
        setActiveIndex(lastIndex(items));

        return handled();
      case 'ArrowRight':
        if (entry && isSubmenu(entry) && !entry.disabled) {
          openSubmenuAt(entry.key, activeIndex);

          return handled();
        }

        return;
      case 'ArrowLeft':
        if (openSubmenu) {
          closeBranch();

          return handled();
        }

        if (onCloseBranch) {
          onCloseBranch();

          return handled();
        }

        return;
      case 'Escape':
        if (openSubmenu) closeBranch();
        else if (onCloseBranch) onCloseBranch();
        else onClose();

        return handled();
      default:
        return;
    }
  };

  return (
    <Floating
      anchor={anchor}
      side={side}
      align={align}
      matchAnchorWidth={matchAnchorWidth}
      panelRef={panelRef}
      className={styles.layer}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={onKeyDown}
    >
      {description && (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
      <ul
        role="menu"
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        className={styles.list}
      >
        {items.map((entry, index) => {
          if (isSeparator(entry)) {
            return <li key={entry.key} role="separator" className={styles.separator} />;
          }

          const submenu = isSubmenu(entry);
          const expanded = submenu && openSubmenu?.key === entry.key;

          return (
            <li key={entry.key} role="none" className={styles.item}>
              <button
                type="button"
                role={!submenu && entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={!submenu && entry.checked !== undefined ? entry.checked : undefined}
                aria-haspopup={submenu ? 'menu' : undefined}
                aria-expanded={submenu ? expanded : undefined}
                disabled={entry.disabled}
                tabIndex={index === activeIndex ? 0 : -1}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className={[styles.button, !submenu && entry.danger && styles.danger]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => {
                  setActiveIndex(index);

                  if (submenu) openSubmenuAt(entry.key, index);
                  else setOpenSubmenu(null);
                }}
                onClick={() => {
                  if (submenu) {
                    if (expanded) setOpenSubmenu(null);
                    else openSubmenuAt(entry.key, index);

                    return;
                  }

                  entry.onSelect();
                  onClose();
                }}
              >
                <span className={styles.mark} aria-hidden="true">
                  {!submenu && entry.checked !== undefined && (
                    <span className={entry.checked ? styles.ringOn : styles.ring} />
                  )}
                  {entry.icon}
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>{entry.label}</span>
                  {!submenu && entry.description && (
                    <span className={styles.itemDescription}>{entry.description}</span>
                  )}
                </span>
                {!submenu && entry.shortcut && <Shortcut keys={entry.shortcut} />}
                {submenu && (
                  <span className={styles.caret} aria-hidden="true">
                    <CaretRightIcon />
                  </span>
                )}
              </button>

              {expanded && openSubmenu && (
                <Menu
                  items={entry.items}
                  label={entry.label}
                  anchor={openSubmenu.anchor}
                  side="right"
                  align="start"
                  onClose={onClose}
                  onCloseBranch={closeBranch}
                />
              )}
            </li>
          );
        })}
      </ul>
    </Floating>
  );
}

/** El combo llega ya formateado por i18n; aquí solo se parte para pintarlo. */
function Shortcut({ keys }: { keys: string }) {
  const parts = keys.split('+');

  return (
    <span className={styles.shortcut}>
      {parts.map((part, index) => (
        <span key={`${part}-${String(index)}`}>
          {index > 0 && <span className={styles.plus}>+</span>}
          <Kbd>{part}</Kbd>
        </span>
      ))}
    </span>
  );
}

function CaretRightIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.5 3 7.5 6 4.5 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
