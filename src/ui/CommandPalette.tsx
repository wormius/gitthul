import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { EmptyState } from './EmptyState';
import { Kbd } from './Kbd';
import styles from './CommandPalette.module.css';
import hiddenStyles from './visuallyHidden.module.css';

export interface CommandItem {
  /** Único en toda la paleta, no solo dentro de su grupo. */
  key: string;
  label: string;
  /** Segunda línea: la ruta del repositorio, el SHA, el ajuste al que lleva. */
  description?: string;
  icon?: ReactNode;
  /** Atajo ya formateado. */
  shortcut?: string;
  onSelect: () => void;
}

export interface CommandGroup {
  key: string;
  /** Tipo de resultado: «Repositorios», «Ramas», «Acciones», «Ajustes». */
  label: string;
  items: readonly CommandItem[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Nombre accesible del diálogo. */
  label: string;
  /** Nombre accesible del campo de búsqueda. */
  searchLabel: string;
  placeholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  /** Ya filtrados y agrupados por tipo: filtrar es cosa de quien tiene los datos. */
  groups: readonly CommandGroup[];
  /** Qué decir cuando la búsqueda no encuentra nada. */
  emptyLabel: string;
  emptyDescription?: string;
  toolbar?: ReactNode;
  status?: ReactNode;
  footer?: ReactNode;
}

/**
 * Paleta de comandos: una caja y resultados agrupados por tipo.
 *
 * Es la base de la búsqueda global de la barra inferior, así que el filtrado no
 * vive aquí — la vista que tiene los datos decide qué encaja y cómo se agrupa.
 * El teclado recorre los grupos como si fueran una sola lista, que es como se
 * usa de verdad: escribir y bajar sin pensar en qué sección se está.
 */
export function CommandPalette({
  open,
  onClose,
  label,
  searchLabel,
  placeholder,
  query,
  onQueryChange,
  groups,
  emptyLabel,
  emptyDescription,
  toolbar,
  status,
  footer,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const inputId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Un solo recorrido: los grupos son presentación, el teclado ve una lista.
  const flat = groups.flatMap((group) => group.items);
  const active = flat.find((item) => item.key === activeKey) ?? flat[0];

  useEffect(() => {
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  const move = (step: 1 | -1) => {
    if (flat.length === 0) return;

    const index = flat.findIndex((item) => item.key === active?.key);
    setActiveKey(flat[(index + step + flat.length) % flat.length]?.key ?? null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest('button')) {
      if (event.key === 'Escape') onClose();
      return;
    }
    switch (event.key) {
      case 'Escape':
        event.stopPropagation();
        onClose();

        return;
      case 'ArrowDown':
        event.preventDefault();
        move(1);

        return;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);

        return;
      case 'Home':
        event.preventDefault();
        setActiveKey(flat[0]?.key ?? null);

        return;
      case 'End':
        event.preventDefault();
        setActiveKey(flat.at(-1)?.key ?? null);

        return;
      case 'Enter':
        if (!active) return;

        event.preventDefault();
        onClose();
        active.onSelect();

        return;
      default:
        return;
    }
  };

  return createPortal(
    <div className={styles.scrim} onKeyDown={onKeyDown}>
      <div role="dialog" aria-modal="true" aria-label={label} className={styles.panel}>
        <label className={hiddenStyles.hidden} htmlFor={inputId}>
          {searchLabel}
        </label>
        <div className={styles.searchField}>
          <svg
            className={styles.searchIcon}
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          >
            <circle cx="7" cy="7" r="4.2" />
            <path d="m10.2 10.2 3.3 3.3" />
          </svg>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={active ? `${listId}-${active.key}` : undefined}
            aria-autocomplete="list"
            className={styles.search}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              // Escribir vuelve al primer resultado: recorrer y luego afinar la
              // búsqueda no debe dejar resaltado algo que ya no está en la lista.
              setActiveKey(null);
              onQueryChange(event.target.value);
            }}
          />
        </div>

        {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
        {status && <div className={styles.status}>{status}</div>}
        {flat.length === 0 ? (
          <EmptyState size="sm" title={emptyLabel} description={emptyDescription} />
        ) : (
          <div id={listId} role="listbox" aria-label={label} className={styles.results}>
            {groups.map((group) => (
              <div key={group.key} role="group" aria-label={group.label} className={styles.group}>
                <p className={styles.groupLabel}>{group.label}</p>
                {group.items.map((item) => {
                  const selected = item.key === active?.key;

                  return (
                    <div
                      key={item.key}
                      id={`${listId}-${item.key}`}
                      role="option"
                      aria-selected={selected}
                      className={[styles.option, selected && styles.selected]
                        .filter(Boolean)
                        .join(' ')}
                      onMouseEnter={() => {
                        setActiveKey(item.key);
                      }}
                      onClick={() => {
                        onClose();
                        item.onSelect();
                      }}
                    >
                      {item.icon && (
                        <span className={styles.icon} aria-hidden="true">
                          {item.icon}
                        </span>
                      )}
                      <span className={styles.text}>
                        <span className={styles.label}>{item.label}</span>
                        {item.description && (
                          <span className={styles.description}>{item.description}</span>
                        )}
                      </span>
                      {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
