import {
  useCallback,
  useId,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { ContextMenu } from './ContextMenu';
import {
  DataGridContext,
  DEFAULT_MIN_WIDTH,
  gridTemplate,
  fitColumnWidths,
  resizeColumnWidths,
  type DataGridColumn,
  type DataGridLayout,
} from './dataGridUtils';
import styles from './DataGrid.module.css';
import type { MenuEntry } from './menuUtils';
import { usePaneStorage } from './paneStorage';

interface DataGridProps {
  columns: readonly DataGridColumn[];
  /** Nombre accesible de la tabla, p. ej. «Commits de gitthul». */
  label: string;
  /** Cuántas filas hay en total, incluidas las que la virtualización no montó. */
  rowCount: number;
  /** Identidad con la que se recuerdan los anchos. Sin ella viven en memoria. */
  storageId?: string;
  hidden?: ReadonlySet<string>;
  onHiddenChange?: (next: ReadonlySet<string>) => void;
  /** Con etiqueta, la cabecera ofrece por menú contextual qué columnas se ven. */
  columnsMenuLabel?: string;
  /**
   * Rótulo del submenú que agrupa las columnas ocultables.
   *
   * Sin él las casillas van sueltas en la raíz del menú, que es como nació en
   * F0.6 cuando era lo único que ese menú ofrecía. Con él —y con `menuExtras`—
   * la cabecera puede ofrecer más cosas sin que la lista de columnas se coma el
   * menú entero.
   */
  columnsGroupLabel?: string;
  /** Lo que esta tabla en concreto suma a su menú de cabecera. */
  menuExtras?: readonly MenuEntry[];
  /** Con rótulo, el menú ofrece devolver los anchos a los de fábrica. */
  resetWidthsLabel?: string;
  /** Nombre accesible del scroll horizontal de la columna que lo tiene. */
  columnScrollLabel?: string;
  columnScroll?: number;
  onColumnScrollChange?: (offset: number) => void;
  /** Señala los lados con contenido oculto de la columna con scroll propio. */
  columnOverflowIndicator?: 'sawtooth';
  /**
   * El cuerpo. Normalmente una `VirtualList` con `semantics="rowgroup"` que
   * pinta `DataGridRow`, para que la tabla siga siendo una tabla en el árbol
   * de accesibilidad aunque solo existan las filas visibles.
   */
  children: ReactNode;
  className?: string;
}

const RESIZE_STEP = 8;
const COLUMN_SCROLL_STEP = 40;
const WHEEL_LINE_WIDTH = 16;
const MAX_WHEEL_STEP = 24;
const SCROLL_EDGE_TOLERANCE = 0.5;

/**
 * Tabla de columnas redimensionables con la cabecera fuera del scroll.
 *
 * La cabecera es hermana del cuerpo, no una fila pegajosa dentro de él: así no
 * hay un fotograma en el que se despegue al hacer scroll rápido ni queda por
 * debajo de las filas al pasar por encima. La contrapartida es que las dos cajas
 * tienen que compartir el reparto de columnas, y de eso se encarga el contexto.
 *
 * Los anchos se recuerdan por columna, en píxeles y no en fracciones: ocultar
 * una columna o ensanchar la ventana no debe mover las demás de sitio.
 */
export function DataGrid({
  columns,
  label,
  rowCount,
  storageId,
  hidden,
  onHiddenChange,
  columnsMenuLabel,
  columnsGroupLabel,
  menuExtras,
  resetWidthsLabel,
  columnScrollLabel,
  columnScroll,
  onColumnScrollChange,
  columnOverflowIndicator,
  children,
  className,
}: DataGridProps) {
  const store = usePaneStorage();

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};

    for (const column of columns) {
      const saved = storageId ? store.read(`${storageId}.${column.key}`) : null;

      // Cero devuelve una columna flexible al reparto automático.
      if (!column.grow || (saved !== null && saved > 0)) {
        initial[column.key] = saved ?? column.width;
      }
    }

    return initial;
  });

  // Igual que en `SplitPane`: el último ancho aplicado se guarda aparte para que
  // dos pulsaciones de flecha en la misma tarea no calculen las dos desde el
  // mismo punto de partida.
  const applied = useRef(widths);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();
  const columnScrollerRef = useRef<HTMLDivElement>(null);

  const [ownHidden, setOwnHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [ownScroll, setOwnScroll] = useState(0);

  const hiddenKeys = hidden ?? ownHidden;
  const requestedScroll = columnScroll ?? ownScroll;

  const widthOf = useCallback(
    (key: string) => {
      const column = columns.find((candidate) => candidate.key === key);
      const width = widths[key] ?? column?.width ?? 0;
      return Math.max(
        column?.minWidth ?? DEFAULT_MIN_WIDTH,
        Math.min(column?.maxWidth ?? Number.POSITIVE_INFINITY, width),
      );
    },
    [columns, widths],
  );

  const visible = useMemo(
    () => columns.filter((column) => !hiddenKeys.has(column.key)),
    [columns, hiddenKeys],
  );

  const [availableWidth, setAvailableWidth] = useState(0);
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    setAvailableWidth(header.clientWidth);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) setAvailableWidth(entry.contentRect.width);
          });
    observer?.observe(header);
    return () => observer?.disconnect();
  }, []);

  const fitted = useMemo(
    () => fitColumnWidths(visible, widthOf, availableWidth),
    [visible, widthOf, availableWidth],
  );
  const effectiveWidthOf = useCallback(
    (key: string) => fitted[key] ?? widthOf(key),
    [fitted, widthOf],
  );

  const scrollable = visible.find((column) => column.contentWidth !== undefined);
  const scrollableKey = scrollable?.key;
  const columnWidth = scrollable ? effectiveWidthOf(scrollable.key) : 0;
  const maxScroll = scrollable ? Math.max(0, scrollable.contentWidth! - columnWidth) : 0;
  const scrollOffset = Math.min(maxScroll, Math.max(0, requestedScroll));
  const appliedScroll = useRef(scrollOffset);
  // Si el contenido se encoge o la columna crece, no conservar un offset
  // inválido que reaparecería al volver a estrecharla.
  if (columnScroll === undefined && ownScroll !== scrollOffset) setOwnScroll(scrollOffset);
  const hiddenAtStart = scrollOffset > SCROLL_EDGE_TOLERANCE;
  const hiddenAtEnd = maxScroll - scrollOffset > SCROLL_EDGE_TOLERANCE;
  const columnStart = scrollable
    ? visible
        .slice(0, visible.indexOf(scrollable))
        .reduce((left, column) => left + effectiveWidthOf(column.key), 0)
    : 0;

  useLayoutEffect(() => {
    appliedScroll.current = scrollOffset;
  }, [scrollOffset, scrollableKey, columnWidth]);

  const changeColumnScroll = useCallback(
    (offset: number) => {
      const next = Math.min(maxScroll, Math.max(0, offset));
      const previous = appliedScroll.current;
      if (columnScroll === undefined) setOwnScroll(next);
      // Acumular ráfagas sin perder deltas finos antes del siguiente render.
      appliedScroll.current = columnScroll === undefined ? next : scrollOffset;
      if (next !== previous) onColumnScrollChange?.(next);
    },
    [columnScroll, maxScroll, onColumnScrollChange, scrollOffset],
  );

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const scroller = columnScrollerRef.current;
    if (!body || !scrollableKey || maxScroll === 0) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !(event.target instanceof Element)) return;
      const overScroller = scroller?.contains(event.target);
      if (!overScroller) {
        const cell = event.target.closest('[data-column-key]');
        if (cell?.getAttribute('data-column-key') !== scrollableKey) return;
        if (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) return;
      }
      const delta = event.deltaX || (event.shiftKey || overScroller ? event.deltaY : 0);
      if (!delta) return;
      const unit =
        event.deltaMode === 1 ? WHEEL_LINE_WIDTH : event.deltaMode === 2 ? columnWidth : 1;
      // Una muesca suele llegar como 120 px o varias líneas: en una columna
      // estrecha no debe saltar directamente de un extremo al otro.
      const stepLimit = Math.max(1, Math.min(MAX_WHEEL_STEP, columnWidth / 4));
      const step = Math.sign(delta) * Math.min(Math.abs(delta * unit), stepLimit);
      const previous = appliedScroll.current;
      const next = Math.min(maxScroll, Math.max(0, previous + step));
      if (next === previous) return;
      event.preventDefault();
      changeColumnScroll(next);
    };
    // React registra wheel como pasivo; aquí sólo consumimos el gesto horizontal
    // que realmente mueve esta columna, conservando rueda vertical y zoom.
    body.addEventListener('wheel', wheel, { passive: false });
    return () => body.removeEventListener('wheel', wheel);
  }, [changeColumnScroll, columnWidth, maxScroll, scrollableKey]);

  const layout: DataGridLayout = useMemo(
    () => ({
      columns: visible,
      widthOf: effectiveWidthOf,
      template: gridTemplate(
        visible.map((column) =>
          availableWidth > 0 || (column.grow && widths[column.key] !== undefined)
            ? { ...column, grow: false }
            : column,
        ),
        effectiveWidthOf,
      ),
      columnScroll: scrollOffset,
    }),
    [scrollOffset, visible, effectiveWidthOf, widths, availableWidth],
  );

  const resize = useCallback(
    (column: DataGridColumn, compute: (current: number) => number) => {
      const available = availableWidth || headerRef.current?.clientWidth || 0;
      if (available > 0) {
        setAvailableWidth(available);
        const current = fitColumnWidths(
          visible,
          (key) => {
            const candidate = visible.find((item) => item.key === key)!;
            return applied.current[key] ?? candidate.width;
          },
          available,
        );
        applied.current = {
          ...applied.current,
          ...resizeColumnWidths(visible, current, column.key, compute(current[column.key]!)),
        };
      } else {
        // Antes de disponer de medidas, usamos los anchos preferidos.
        const base = applied.current[column.key] ?? column.width;
        applied.current = {
          ...applied.current,
          [column.key]: Math.min(
            column.maxWidth ?? Infinity,
            Math.max(compute(base), column.minWidth ?? DEFAULT_MIN_WIDTH),
          ),
        };
      }
      setWidths(applied.current);
      if (storageId) {
        for (const candidate of visible) {
          const width = applied.current[candidate.key];
          if (width !== undefined) store.write(`${storageId}.${candidate.key}`, width);
        }
      }
    },
    [store, storageId, visible, availableWidth],
  );

  const toggleHidden = (key: string) => {
    const next = new Set(hiddenKeys);

    if (!next.delete(key)) next.add(key);

    if (hidden === undefined) setOwnHidden(next);

    onHiddenChange?.(next);
  };

  const resetWidths = () => {
    const defaults: Record<string, number> = {};

    for (const column of columns) {
      if (!column.grow) defaults[column.key] = column.width;

      if (storageId) store.write(`${storageId}.${column.key}`, column.grow ? 0 : column.width);
    }

    applied.current = defaults;
    setWidths(defaults);
  };

  const columnEntries: MenuEntry[] = columns
    .filter((column) => column.hideable !== false)
    .map((column) => ({
      key: column.key,
      label: column.name ?? column.key,
      checked: !hiddenKeys.has(column.key),
      onSelect: () => {
        toggleHidden(column.key);
      },
    }));

  const columnsMenu: MenuEntry[] = [
    ...(columnsGroupLabel === undefined
      ? columnEntries
      : [
          {
            kind: 'submenu' as const,
            key: 'columns',
            label: columnsGroupLabel,
            items: columnEntries,
          },
        ]),
    ...(menuExtras ?? []),
    ...(resetWidthsLabel === undefined
      ? []
      : [{ key: 'resetWidths', label: resetWidthsLabel, onSelect: resetWidths }]),
  ];

  const header = (
    <div
      ref={headerRef}
      className={styles.header}
      role="row"
      aria-rowindex={1}
      style={{ gridTemplateColumns: layout.template }}
    >
      {visible.map((column, index) => (
        <div
          key={column.key}
          data-column-key={column.key}
          role="columnheader"
          aria-colindex={index + 1}
          className={[styles.headerCell, column.align === 'end' ? styles.end : '']
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.headerLabel}>{column.header}</span>

          {column.resizable !== false && (availableWidth === 0 || index < visible.length - 1) && (
            <ColumnResizer column={column} width={effectiveWidthOf(column.key)} onResize={resize} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <DataGridContext value={layout}>
      <div
        className={[styles.grid, scrollable ? styles.columnScrollable : '', className]
          .filter(Boolean)
          .join(' ')}
      >
        <div
          role="grid"
          aria-label={label}
          aria-colcount={visible.length}
          aria-rowcount={rowCount + 1}
          className={styles.table}
        >
          <div role="rowgroup" className={styles.headerGroup}>
            {columnsMenuLabel ? (
              <ContextMenu items={columnsMenu} label={columnsMenuLabel}>
                {header}
              </ContextMenu>
            ) : (
              header
            )}
          </div>

          <div ref={bodyRef} id={bodyId} className={styles.body}>
            {children}
            {columnOverflowIndicator === 'sawtooth' &&
              rowCount > 0 &&
              (hiddenAtStart || hiddenAtEnd) && (
                <div
                  className={styles.columnClipping}
                  style={{ left: columnStart, width: columnWidth }}
                  aria-hidden="true"
                >
                  {hiddenAtStart && <ClippedColumnEdge side="start" />}
                  {hiddenAtEnd && <ClippedColumnEdge side="end" />}
                </div>
              )}
            {scrollable && maxScroll > SCROLL_EDGE_TOLERANCE && (
              <ColumnScrollbar
                trackRef={columnScrollerRef}
                controlsId={bodyId}
                label={columnScrollLabel}
                left={columnStart}
                width={columnWidth}
                contentWidth={scrollable.contentWidth!}
                offset={scrollOffset}
                maxScroll={maxScroll}
                onChange={changeColumnScroll}
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey) return;
                  let next: number;
                  if (event.key === 'ArrowLeft') next = appliedScroll.current - COLUMN_SCROLL_STEP;
                  else if (event.key === 'ArrowRight')
                    next = appliedScroll.current + COLUMN_SCROLL_STEP;
                  else if (event.key === 'PageUp') next = appliedScroll.current - columnWidth;
                  else if (event.key === 'PageDown') next = appliedScroll.current + columnWidth;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = maxScroll;
                  else return;
                  event.preventDefault();
                  event.stopPropagation();
                  changeColumnScroll(next);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </DataGridContext>
  );
}

interface ColumnScrollbarProps {
  trackRef: RefObject<HTMLDivElement | null>;
  controlsId: string;
  label?: string;
  left: number;
  width: number;
  contentWidth: number;
  offset: number;
  maxScroll: number;
  onChange: (offset: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** Indicador propio: WebKit puede pintar una pista opaca y expandirla en hover. */
function ColumnScrollbar({
  trackRef,
  controlsId,
  label,
  left,
  width,
  contentWidth,
  offset,
  maxScroll,
  onChange,
  onKeyDown,
}: ColumnScrollbarProps) {
  const inset = Math.min(2, width / 4);
  const trackWidth = Math.max(0, width - inset * 2);
  const thumbWidth = Math.min(trackWidth, Math.max(16, (trackWidth * width) / contentWidth));
  const travel = trackWidth - thumbWidth;
  const thumbLeft = (offset / maxScroll) * travel;
  const drag = useRef<{ pointerId: number; x: number; offset: number } | null>(null);

  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={trackRef}
      className={styles.columnScrollbar}
      style={{ left: left + inset, width: trackWidth }}
      role="scrollbar"
      aria-label={label}
      aria-controls={controlsId}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={maxScroll}
      aria-valuenow={offset}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0 || travel <= 0 || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
        const onThumb = x >= thumbLeft && x <= thumbLeft + thumbWidth;
        const next = onThumb
          ? offset
          : Math.min(maxScroll, Math.max(0, ((x - thumbWidth / 2) / travel) * maxScroll));
        if (!onThumb) onChange(next);
        drag.current = { pointerId: event.pointerId, x: event.clientX, offset: next };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const origin = drag.current;
        if (!origin || origin.pointerId !== event.pointerId || travel <= 0) return;
        event.preventDefault();
        onChange(origin.offset + ((event.clientX - origin.x) / travel) * maxScroll);
      }}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
    >
      <span
        className={styles.columnThumb}
        style={{ left: thumbLeft, width: thumbWidth }}
        aria-hidden="true"
      />
    </div>
  );
}

function ClippedColumnEdge({ side }: { side: 'start' | 'end' }) {
  const patternId = useId();
  return (
    <svg
      className={`${styles.clippedEdge} ${side === 'start' ? styles.clippedStart : styles.clippedEnd}`}
      data-overflow-edge={side}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id={patternId} width="6" height="12" patternUnits="userSpaceOnUse">
          <path d="M6 0H5.5L0.5 6L5.5 12H6Z" fill="var(--surface-app)" />
          <path d="M5.5 0 0.5 6 5.5 12" fill="none" stroke="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}

interface ColumnResizerProps {
  column: DataGridColumn;
  width: number;
  onResize: (column: DataGridColumn, compute: (current: number) => number) => void;
}

/**
 * Separador de ancho de columna.
 *
 * Se agarra con el puntero y se mueve con las flechas: la misma acción por dos
 * caminos, como pide la invariante 3. La zona de agarre es más ancha que la
 * línea que se ve, y ninguna de las dos cambia de tamaño al pasar por encima.
 */
function ColumnResizer({ column, width, onResize }: ColumnResizerProps) {
  const originRef = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    originRef.current = {
      x: event.clientX,
      width: event.currentTarget.parentElement?.getBoundingClientRect().width || width,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = originRef.current;

    if (!origin) return;

    onResize(column, () => origin.width + (event.clientX - origin.x));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!originRef.current) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    originRef.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onResize(column, (current) => current - RESIZE_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onResize(column, (current) => current + RESIZE_STEP);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={column.resizeLabel ?? column.name ?? column.key}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className={styles.resizer}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <span className={styles.resizerLine} aria-hidden="true" />
    </div>
  );
}
