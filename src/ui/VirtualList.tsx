import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { useSelection, type SelectionMode } from './selection';
import { useDragAutoScroll } from './useDragAutoScroll';
import styles from './VirtualList.module.css';

/**
 * Lo que se puede pedirle a la lista desde fuera.
 *
 * Solo desplazar: la selección y el contenido ya viajan como props, y añadirlos
 * aquí daría dos formas de hacer lo mismo. Llevar la lista hasta una fila, en
 * cambio, no se puede expresar como estado — pedir dos veces la misma fila
 * tiene que desplazar dos veces.
 */
export interface VirtualListHandle {
  scrollToIndex: (index: number) => void;
}

export interface VirtualRowContext {
  index: number;
  selected: boolean;
  /** La fila que recibiría Enter. Solo una a la vez, y no implica selección. */
  active: boolean;
}

interface VirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderRow: (item: T, context: VirtualRowContext) => ReactNode;
  /** Nombre accesible de la lista, p. ej. «Commits de gitthul». */
  label: string;
  /**
   * Qué es la lista en el árbol de accesibilidad. `rowgroup` es la que va
   * dentro de un `DataGrid`: allí las filas son filas de tabla, no opciones de
   * una lista, y el nombre y el recuento los pone la tabla.
   */
  semantics?: 'auto' | 'rowgroup';
  /** Alto estimado de fila. Por defecto el de la densidad cómoda. */
  rowHeight?: number;
  overscan?: number;
  selectionMode?: SelectionMode;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: ReadonlySet<string>) => void;
  /** Doble clic o Enter. Es el «abrir» de la fila. */
  onActivate?: (item: T, index: number) => void;
  /** Qué se pinta cuando no queda nada, por ejemplo tras filtrar. */
  empty?: ReactNode;
  className?: string;
  /**
   * Contenedor de scroll externo. Cuando se pasa, la lista no scrollea por sí
   * misma: usa el padre como scroll element y `scrollMargin` para compensar el
   * contenido que hay por encima dentro de ese contenedor. Permite que varias
   * secciones y esta lista compartan un solo scroll.
   */
  scrollParent?: React.RefObject<HTMLElement | null>;
  /**
   * El rango de filas montadas, cada vez que cambia.
   *
   * No reinventa la virtualización: solo asoma el rango que TanStack Virtual ya
   * calculó, para quien necesite reaccionar a que el scroll se acerca al final
   * — la paginación de `CommitTable` es el primer consumidor. No dispara nada
   * por sí sola.
   */
  onRangeChange?: (range: { startIndex: number; endIndex: number }) => void;
  /** Mando de la lista: hoy solo «llévame a esta fila». */
  handleRef?: Ref<VirtualListHandle>;
  /**
   * Activa el auto-scroll al arrastrar cerca de los bordes del viewport.
   *
   * Usa `dragover` como reloj porque el WebKit de la ventana Tauri no reparte
   * `requestAnimationFrame` ni `setTimeout` dentro del bucle de arrastre.
   */
  dragAutoScroll?: boolean;
}

const DEFAULT_ROW_HEIGHT = 28;

/** Ref inerte que `useDragAutoScroll` ignora cuando el auto-scroll está apagado. */
const NULL_REF: React.RefObject<HTMLElement | null> = { current: null };

/**
 * Lista virtualizada con selección múltiple.
 *
 * Solo existen en el DOM las filas visibles más un pequeño margen, así que cien
 * mil commits cuestan lo mismo que cien. Por eso el foco no viaja fila a fila
 * sino que se queda en el contenedor y se anuncia con `aria-activedescendant`:
 * la fila enfocada podría estar desmontada un fotograma después, y un foco sobre
 * un nodo que desaparece devuelve el teclado a `body`.
 *
 * El compilador de React no memoiza estos dos componentes y avisa de ello: la
 * API de TanStack Virtual devuelve funciones que no puede memoizar sin arriesgar
 * interfaz obsoleta, así que se salta el archivo entero. Es lo correcto —
 * memoizar aquí daría filas que no se repintan al hacer scroll — y por eso el
 * aviso se deja puesto en vez de silenciarlo.
 */
export function VirtualList<T>({
  items,
  getKey,
  renderRow,
  label,
  semantics = 'auto',
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = 8,
  selectionMode = 'none',
  selected,
  onSelectedChange,
  onActivate,
  empty,
  className,
  scrollParent,
  onRangeChange,
  handleRef,
  dragAutoScroll = false,
}: VirtualListProps<T>) {
  const baseId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const activeKeyRef = useRef<string | null>(null);

  // Auto-scroll al arrastrar cerca de los bordes — usa el contenedor de scroll
  // efectivo (externo o propio) como zona de detección.
  useDragAutoScroll(dragAutoScroll ? (scrollParent ?? scrollRef) : NULL_REF);

  // Recorrer los cien mil elementos solo tiene sentido cuando alguien extiende
  // un rango con Mayús o pulsa Ctrl+A; el resto del tiempo basta la clave de la
  // fila que se está pintando.
  const allIds = useCallback(
    () => items.map((item, index) => getKey(item, index)),
    [getKey, items],
  );

  const selection = useSelection(selectionMode, selected, onSelectedChange);
  const selectable = selectionMode !== 'none';
  const keyboardNavigable = selectable || onActivate !== undefined;
  const inGrid = semantics === 'rowgroup';

  // Cuando hay scrollParent, el virtualizador usa ese contenedor como scroll
  // element y `scrollMargin` compensa el offset de la lista dentro de él, que
  // es lo que deja a varias secciones y esta lista compartir un solo scroll.
  const useExternalScroll = scrollParent !== undefined;

  // El margen se mide como la distancia entre el tope del scroll container y el
  // tope de esta lista. Se usa `useLayoutEffect` para que la medición ocurra
  // antes del primer paint y el virtualizador arranque con el rango correcto.
  const scrollMarginRef = useRef(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Se ejecuta en cada render a propósito: necesita remedir después de
  // cualquier cambio de DOM que altere la posición de la lista (espacios que se
  // pliegan, filtro que oculta los recientes). La guarda con el ref impide el
  // bucle infinito.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!useExternalScroll) return;

    const list = scrollRef.current;
    const parent = scrollParent.current;

    if (!list || !parent) return;

    // `offsetTop` relativo al offsetParent. Si el scroll container no es el
    // offsetParent inmediato hay que acumular, pero en este layout sí lo es.
    let offset = 0;
    let el: HTMLElement | null = list;

    while (el && el !== parent) {
      offset += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }

    if (offset !== scrollMarginRef.current) {
      scrollMarginRef.current = offset;
      setScrollMargin(offset);
    }
  });

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () =>
      useExternalScroll ? (scrollParent.current ?? null) : (scrollRef.current ?? null),
    estimateSize: () => rowHeight,
    getItemKey: (index) => {
      const item = items[index];

      return item === undefined ? index : getKey(item, index);
    },
    overscan,
    scrollMargin: useExternalScroll ? scrollMargin : 0,
  });

  const range = virtualizer.range;

  useEffect(() => {
    if (range) onRangeChange?.(range);
  }, [range, onRangeChange]);

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToIndex: (index: number) => {
        const clamped = Math.min(Math.max(index, 0), Math.max(items.length - 1, 0));
        const item = items[clamped];

        activeIndexRef.current = clamped;
        activeKeyRef.current = item === undefined ? null : getKey(item, clamped);
        setActiveIndex(clamped);
        // Centrada y no pegada al borde: quien pide «ir al nodo de `dev`»
        // quiere verlo con su alrededor, no en la última línea de la ventana.
        virtualizer.scrollToIndex(clamped, { align: 'center' });
      },
    }),
    [getKey, items, virtualizer],
  );

  const move = useCallback(
    (index: number, event: KeyboardEvent<HTMLDivElement>) => {
      const clamped = Math.min(Math.max(index, 0), items.length - 1);
      const item = items[clamped];

      activeIndexRef.current = clamped;
      activeKeyRef.current = item === undefined ? null : getKey(item, clamped);
      setActiveIndex(clamped);
      virtualizer.scrollToIndex(clamped);

      if (item !== undefined && selectable) {
        selection.select(getKey(item, clamped), allIds, event);
      }
    },
    [allIds, getKey, items, selectable, selection, virtualizer],
  );

  useEffect(() => {
    const last = Math.max(items.length - 1, 0);
    let next = Math.min(activeIndexRef.current, last);
    const activeKey = activeKeyRef.current;
    const onlySelected = selected?.size === 1 ? selected.values().next().value : undefined;

    // Al entrar por teclado en una lista cuya selección vino del store, las
    // flechas deben partir de esa fila y no de la primera. Esto también mantiene
    // alineados foco y selección cuando otra vista elige una fila.
    if (activeKey === null && onlySelected !== undefined) {
      const found = items.findIndex((item, index) => getKey(item, index) === onlySelected);

      if (found >= 0) {
        next = found;
        activeKeyRef.current = onlySelected;
      }
    }

    // Conservar la identidad, no la posición: al insertar, quitar, filtrar o
    // plegar filas, el mismo índice puede señalar otra cosa. La búsqueda solo
    // ocurre cuando esa identidad ya no está justo donde estaba.
    if (activeKeyRef.current !== null) {
      const resolvedKey = activeKeyRef.current;
      const current = items[next];

      if (current === undefined || getKey(current, next) !== resolvedKey) {
        const found = items.findIndex((item, index) => getKey(item, index) === resolvedKey);

        if (found >= 0) next = found;
        else activeKeyRef.current = null;
      }
    }

    activeIndexRef.current = next;
    if (activeIndex !== next) setActiveIndex(next);
  }, [activeIndex, getKey, items, selected]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!keyboardNavigable || items.length === 0) return;

    // El ref hace que la repetición rápida de una tecla acumule cada paso aun
    // cuando React agrupe varios keydown antes del siguiente render.
    const currentIndex = activeIndexRef.current;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(currentIndex + 1, event);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(currentIndex - 1, event);
        break;
      case 'Home':
        event.preventDefault();
        move(0, event);
        break;
      case 'End':
        event.preventDefault();
        move(items.length - 1, event);
        break;
      case ' ': {
        if (!selectable || event.target !== event.currentTarget) return;
        const item = items[currentIndex];
        if (item === undefined) return;
        event.preventDefault();
        const id = getKey(item, currentIndex);
        activeKeyRef.current = id;
        selection.select(id, allIds, event);
        break;
      }
      case 'Enter': {
        const item = items[currentIndex];

        if (item !== undefined) {
          event.preventDefault();
          onActivate?.(item, currentIndex);
        }

        break;
      }
      case 'a':
      case 'A':
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          selection.selectAll(allIds);
        }

        break;
      default:
        break;
    }
  };

  const activeItem = items[activeIndex];
  const activeId = activeItem === undefined ? undefined : getKey(activeItem, activeIndex);

  return (
    <div
      ref={scrollRef}
      className={[styles.viewport, useExternalScroll && styles.embedded, className]
        .filter(Boolean)
        .join(' ')}
      role={inGrid ? 'rowgroup' : selectable ? 'listbox' : 'list'}
      aria-label={inGrid ? undefined : label}
      aria-multiselectable={!inGrid && selectionMode === 'multiple' ? true : undefined}
      aria-activedescendant={
        keyboardNavigable && activeId !== undefined ? `${baseId}${activeId}` : undefined
      }
      tabIndex={keyboardNavigable ? 0 : undefined}
      onKeyDown={onKeyDown}
    >
      {items.length === 0 ? (
        <div className={styles.empty}>{empty}</div>
      ) : (
        <div className={styles.canvas} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = items[row.index];

            if (item === undefined) return null;

            const id = getKey(item, row.index);

            return (
              <div
                key={id}
                id={`${baseId}${id}`}
                role={inGrid ? 'presentation' : selectable ? 'option' : 'listitem'}
                aria-selected={!inGrid && selectable ? selection.isSelected(id) : undefined}
                className={[styles.row, inGrid && styles.inGrid].filter(Boolean).join(' ')}
                data-selected={selection.isSelected(id) ? '' : undefined}
                data-active={keyboardNavigable && row.index === activeIndex ? '' : undefined}
                style={{
                  height: row.size,
                  transform: `translateY(${String(row.start - virtualizer.options.scrollMargin)}px)`,
                }}
                onMouseDownCapture={(event) => {
                  if (event.button !== 0 || !(event.target instanceof Element)) return;
                  const draggable = event.target.closest('[draggable="true"]');
                  if (draggable === null || !event.currentTarget.contains(draggable)) return;

                  // Un hijo arrastrable puede conservar la selección deteniendo
                  // el mousedown, pero el cursor de teclado debe seguir a esa fila.
                  activeIndexRef.current = row.index;
                  activeKeyRef.current = id;
                  setActiveIndex(row.index);
                }}
                onMouseDown={(event) => {
                  // Solo el clic izquierdo selecciona: el derecho abre el menú
                  // contextual sin cambiar la selección ni disparar el diff.
                  if (event.button !== 0) return;

                  activeIndexRef.current = row.index;
                  activeKeyRef.current = id;
                  setActiveIndex(row.index);

                  if (selectable) selection.select(id, allIds, event);
                }}
                onDoubleClick={() => {
                  onActivate?.(item, row.index);
                }}
              >
                {renderRow(item, {
                  index: row.index,
                  selected: selection.isSelected(id),
                  active: row.index === activeIndex,
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
