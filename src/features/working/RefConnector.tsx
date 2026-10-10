import type { GraphColumn } from './CommitGraph';
import { lineStyleFor } from './graphPaint';
import styles from './RefConnector.module.css';

interface RefConnectorProps {
  column: GraphColumn;
  row: number;
}

/**
 * El tramo de la referencia dentro de la columna Rama/Tag.
 *
 * Es SVG y no borde CSS porque el patrón de trazo de la rama es uno de los
 * tres portadores de significado del grafo. La caja es flexible: empieza justo
 * después de `etiqueta +N` y termina en el borde de la celda, donde el canvas
 * continúa hasta el nodo de la calle correspondiente.
 */
export function RefConnector({ column, row }: RefConnectorProps) {
  const node = column.layout.nodeAt(row);
  const line = lineStyleFor(column.palette, node.color);
  const middle = column.metrics.rowHeight / 2;

  return (
    <span className={styles.connector} aria-hidden="true">
      <svg
        className={styles.line}
        viewBox={`0 0 100 ${String(column.metrics.rowHeight)}`}
        preserveAspectRatio="none"
      >
        <line
          x1="0"
          y1={middle}
          x2="100"
          y2={middle}
          stroke={line.color}
          strokeWidth={column.metrics.lineWidth * 0.5}
          strokeDasharray={line.dash.length === 0 ? undefined : line.dash.join(' ')}
          strokeLinecap="butt"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}
