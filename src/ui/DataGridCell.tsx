import type { ReactNode } from 'react';

import { useDataGridLayout } from './dataGridUtils';
import styles from './DataGridCell.module.css';

interface DataGridCellProps {
  /** Debe coincidir con la clave de la columna: de ahí saca alineación y scroll. */
  columnKey: string;
  className?: string;
  children: ReactNode;
}

/**
 * Celda de la tabla.
 *
 * La columna con scroll horizontal propio no se desplaza con `scrollLeft` en
 * cada celda — serían miles de contenedores con su propio scroll — sino
 * moviendo el contenido con `transform` a partir del desplazamiento único que
 * guarda la tabla. Así el grafo se desplaza en bloque y en una sola capa.
 */
export function DataGridCell({ columnKey, className, children }: DataGridCellProps) {
  const layout = useDataGridLayout();
  const column = layout.columns.find((candidate) => candidate.key === columnKey);

  if (!column) return null;

  const classes = [styles.cell, column.align === 'end' ? styles.end : '', className]
    .filter(Boolean)
    .join(' ');

  if (column.contentWidth === undefined) {
    return (
      <div role="gridcell" className={classes}>
        {children}
      </div>
    );
  }

  return (
    <div role="gridcell" className={[classes, styles.clipped].filter(Boolean).join(' ')}>
      <div
        className={styles.scrolled}
        style={{
          width: column.contentWidth,
          transform: `translateX(${String(-layout.columnScroll)}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
