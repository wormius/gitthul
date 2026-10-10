import type { HTMLAttributes, ReactNode } from 'react';

import { Dropdown } from './Dropdown';
import type { MenuEntry } from './menuUtils';
import styles from './Toolbar.module.css';

interface ToolbarOverflow {
  /** Etiqueta accesible del desplegable, p. ej. «Más acciones de GitWorking». */
  label: string;
  icon?: ReactNode;
  items: readonly MenuEntry[];
}

interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  label: string;
  /** Acciones que no caben en la barra. Se fijan al final y no se envuelven. */
  overflow?: ToolbarOverflow;
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

/**
 * Agrupador de controles con semántica de barra de herramientas.
 *
 * El desbordamiento va declarado, no medido: quien arma la barra dice qué
 * acciones son secundarias y esas viven en el desplegable del final. Repartir a
 * ojo por anchura obligaría a duplicar cada rótulo — el botón y su entrada de
 * menú — y dejaría el reparto a merced de la densidad y del idioma, que es
 * exactamente lo que no debe decidir dónde está una acción.
 */
export function Toolbar({
  orientation = 'horizontal',
  label,
  overflow,
  className,
  children,
  ...rest
}: ToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      className={[styles.toolbar, styles[orientation], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
      {overflow && overflow.items.length > 0 && (
        <Dropdown
          className={styles.overflow}
          label={overflow.label}
          icon={overflow.icon ?? <EllipsisIcon />}
          hideLabel
          variant="ghost"
          items={overflow.items}
          align="end"
        />
      )}
    </div>
  );
}
