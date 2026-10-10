import { useMemo, type CSSProperties } from 'react';

import { buildHeatmapGrid, type HeatmapCell, type HeatmapDay } from './heatmap';
import styles from './Heatmap.module.css';

interface HeatmapLegend {
  lessLabel: string;
  moreLabel: string;
}

interface HeatmapProps {
  days: readonly HeatmapDay[];
  /** Nombre accesible del conjunto, ya redactado por quien lo consume. */
  label: string;
  /** Último día representado, en ISO. Por defecto, el más reciente de los datos. */
  end?: string;
  /** Columnas como máximo. Las que no quepan se recortan por la izquierda. */
  weeks?: number;
  weekStartsOn?: 0 | 1;
  /** Texto que sale al posar el puntero sobre un día. */
  describeDay?: (cell: HeatmapCell) => string;
  legend?: HeatmapLegend;
  className?: string;
}

const LEGEND_LEVELS = [0, 1, 2, 3, 4];

/**
 * Mapa de calor de actividad diaria.
 *
 * No tiene scroll a propósito: un mapa que hay que arrastrar deja de ser un
 * vistazo. La cuadrícula se ancla a la derecha para conservar siempre visible
 * la actividad reciente; al crecer el contenedor revela más semanas antiguas
 * hacia la izquierda y, cuando ya cabe el periodo completo, reparte el espacio
 * sobrante entre sus celdas cuadradas.
 */
export function Heatmap({
  days,
  label,
  end,
  weeks = 53,
  weekStartsOn = 1,
  describeDay,
  legend,
  className,
}: HeatmapProps) {
  const grid = useMemo(
    () => buildHeatmapGrid(days, { end, weeks, weekStartsOn }),
    [days, end, weeks, weekStartsOn],
  );

  return (
    <div className={[styles.heatmap, className].filter(Boolean).join(' ')}>
      <div className={styles.clip}>
        <div
          className={styles.grid}
          style={{ '--heat-weeks': grid.weeks.length } as CSSProperties}
          role="img"
          aria-label={label}
        >
          {grid.weeks.map((week, index) => (
            <div className={styles.week} key={`${grid.from}-${String(index)}`}>
              {week.map((cell, day) =>
                cell ? (
                  <div
                    key={cell.date}
                    className={styles.cell}
                    style={{ backgroundColor: `var(--heat-${String(cell.level)})` }}
                    title={describeDay?.(cell)}
                  />
                ) : (
                  <div key={`${String(index)}-${String(day)}`} className={styles.gap} />
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      {legend && (
        <div className={styles.legend}>
          <span className={styles.legendLabel}>{legend.lessLabel}</span>
          {LEGEND_LEVELS.map((level) => (
            <span
              key={level}
              className={[styles.cell, styles.legendCell].join(' ')}
              style={{ backgroundColor: `var(--heat-${String(level)})` }}
            />
          ))}
          <span className={styles.legendLabel}>{legend.moreLabel}</span>
        </div>
      )}
    </div>
  );
}
