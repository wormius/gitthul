import type { ReactNode } from 'react';

import { Dropdown } from './Dropdown';
import type { MenuEntry } from './menuUtils';
import styles from './Breadcrumb.module.css';

export interface BreadcrumbItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Sin acción, el tramo se pinta como texto: así es siempre el último. */
  onSelect?: () => void;
}

interface BreadcrumbProps {
  /** Nombre accesible de la ruta: «Ruta del archivo», «Secciones». */
  label: string;
  items: readonly BreadcrumbItem[];
  /** A partir de cuántos tramos se pliega el centro. Exige `overflowLabel`. */
  maxVisible?: number;
  /** Etiqueta accesible del desplegable de tramos plegados. */
  overflowLabel?: string;
}

/**
 * Ruta de navegación.
 *
 * Cuando no cabe, lo que se pliega es el centro y nunca los extremos: la raíz
 * dice dónde estás y el último tramo dice qué miras. El pliegue sale en un
 * desplegable, no en un «…» muerto.
 */
export function Breadcrumb({ label, items, maxVisible, overflowLabel }: BreadcrumbProps) {
  const collapses = Boolean(maxVisible && overflowLabel && items.length > maxVisible);
  const hidden = collapses ? items.slice(1, items.length - (maxVisible ?? 0) + 1) : [];
  const visible = collapses ? [items[0], ...items.slice(1 + hidden.length)] : [...items];

  const hiddenEntries: MenuEntry[] = hidden.map((item) => ({
    key: item.key,
    label: item.label,
    onSelect: () => item.onSelect?.(),
    disabled: !item.onSelect,
  }));

  return (
    <nav aria-label={label} className={styles.breadcrumb}>
      <ol className={styles.list}>
        {visible.map((item, index) => {
          if (!item) return null;

          const last = index === visible.length - 1;

          return (
            <li key={item.key} className={styles.item}>
              {index === 1 && collapses && overflowLabel && (
                <>
                  <Dropdown
                    label={overflowLabel}
                    icon={<EllipsisIcon />}
                    hideLabel
                    size="sm"
                    variant="ghost"
                    items={hiddenEntries}
                  />
                  <span className={styles.separator} aria-hidden="true">
                    /
                  </span>
                </>
              )}
              {item.onSelect && !last ? (
                <button type="button" className={styles.link} onClick={item.onSelect}>
                  {item.icon && (
                    <span className={styles.icon} aria-hidden="true">
                      {item.icon}
                    </span>
                  )}
                  {item.label}
                </button>
              ) : (
                <span className={styles.current} aria-current={last ? 'page' : undefined}>
                  {item.icon && (
                    <span className={styles.icon} aria-hidden="true">
                      {item.icon}
                    </span>
                  )}
                  {item.label}
                </span>
              )}
              {!last && (
                <span className={styles.separator} aria-hidden="true">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function EllipsisIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </svg>
  );
}
