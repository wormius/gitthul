import type { HTMLAttributes, ReactNode } from 'react';

import { useDataGridLayout } from './dataGridUtils';
import styles from './DataGridRow.module.css';

interface DataGridRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Índice base 0 de la fila. La cabecera ocupa la 1 en `aria-rowindex`. */
  index: number;
  selected?: boolean;
  children: ReactNode;
}

/**
 * Fila de la tabla: la rejilla que alinea las celdas con la cabecera.
 *
 * No lleva el alto: lo pone quien la coloca — normalmente `VirtualList` — porque
 * es esa capa la que sabe cuánto mide cada fila y no puede permitirse medirlas.
 */
export function DataGridRow({ index, selected, className, children, ...rest }: DataGridRowProps) {
  const layout = useDataGridLayout();

  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      aria-selected={selected}
      className={[styles.row, className].filter(Boolean).join(' ')}
      style={{ gridTemplateColumns: layout.template }}
      {...rest}
    >
      {children}
    </div>
  );
}
