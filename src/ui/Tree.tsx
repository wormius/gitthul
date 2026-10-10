import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useSelection, type SelectionMode } from './selection';
import { flattenTree, type FlatTreeNode, type TreeNode } from './treeUtils';
import styles from './Tree.module.css';

interface TreeProps {
  nodes: readonly TreeNode[];
  /** Nombre accesible del árbol, p. ej. «Archivos cambiados». */
  label: string;
  expanded: ReadonlySet<string>;
  onExpandedChange: (next: ReadonlySet<string>) => void;
  /** Contenido de la fila a la derecha del triángulo. Por defecto, la etiqueta. */
  renderNode?: (row: FlatTreeNode, context: { selected: boolean; active: boolean }) => ReactNode;
  chainSingleChild?: boolean;
  rowHeight?: number;
  overscan?: number;
  selectionMode?: SelectionMode;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: ReadonlySet<string>) => void;
  onActivate?: (row: FlatTreeNode) => void;
  empty?: ReactNode;
  className?: string;
  /**
   * Cuando `true`, el viewport se dimensiona a la altura total de su contenido
   * en vez de requerir una caja padre acotada. Útil para árboles pequeños que
   * viven dentro de un contenedor que ya tiene su propio scroll (p. ej. la
   * sección de remotos del RefPanel dentro del scroll del CollapsibleRail).
   */
  autoHeight?: boolean;
}

const DEFAULT_ROW_HEIGHT = 26;
const INDENT_STEP = 14;

function TwistyIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M6 4.5 10 8l-4 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Árbol virtualizado con selección múltiple y expansión encadenada.
 *
 * Comparte con `VirtualList` el modelo de selección y la razón por la que el
 * foco no baja a las filas: solo existen en el DOM las visibles. La expansión
 * encadenada se decide al aplanar (`tree.ts`), de modo que el componente nunca
 * tiene que saber que una fila representa tres carpetas — solo que al abrirla se
 * expande la más profunda de su cadena.
 *
 * El compilador de React no memoiza estos dos componentes y avisa de ello: la
 * API de TanStack Virtual devuelve funciones que no puede memoizar sin arriesgar
 * interfaz obsoleta, así que se salta el archivo entero. Es lo correcto —
 * memoizar aquí daría filas que no se repintan al hacer scroll — y por eso el
 * aviso se deja puesto en vez de silenciarlo.
 */
export function Tree({
  nodes,
  label,
  expanded,
  onExpandedChange,
  renderNode,
  chainSingleChild = true,
  rowHeight = DEFAULT_ROW_HEIGHT,
  overscan = 8,
  selectionMode = 'none',
  selected,
  onSelectedChange,
  onActivate,
  empty,
  className,
  autoHeight = false,
}: TreeProps) {
  const baseId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const activeIdRef = useRef<string | null>(null);

  const rows = useMemo(
    () => flattenTree(nodes, expanded, { chainSingleChild }),
    [chainSingleChild, expanded, nodes],
  );
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const allIds = useCallback(() => ids, [ids]);

  const selection = useSelection(selectionMode, selected, onSelectedChange);
  const selectable = selectionMode !== 'none';

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: (index) => ids[index] ?? index,
    overscan,
  });

  const setExpanded = useCallback(
    (id: string, open: boolean) => {
      const next = new Set(expanded);

      if (open) next.add(id);
      else next.delete(id);

      onExpandedChange(next);
    },
    [expanded, onExpandedChange],
  );

  const move = useCallback(
    (index: number, event: KeyboardEvent<HTMLDivElement>) => {
      const clamped = Math.min(Math.max(index, 0), rows.length - 1);
      const id = ids[clamped];

      activeIndexRef.current = clamped;
      activeIdRef.current = id ?? null;
      setActiveIndex(clamped);
      virtualizer.scrollToIndex(clamped);

      if (id !== undefined && selectable) selection.select(id, allIds, event);
    },
    [allIds, ids, rows.length, selectable, selection, virtualizer],
  );

  useEffect(() => {
    const last = Math.max(rows.length - 1, 0);
    let next = Math.min(activeIndexRef.current, last);
    const onlySelected = selected?.size === 1 ? selected.values().next().value : undefined;

    if (activeIdRef.current === null && onlySelected !== undefined) {
      const found = ids.indexOf(onlySelected);

      if (found >= 0) {
        next = found;
        activeIdRef.current = onlySelected;
      }
    }

    if (activeIdRef.current !== null && ids[next] !== activeIdRef.current) {
      const found = ids.indexOf(activeIdRef.current);

      if (found >= 0) next = found;
      else activeIdRef.current = null;
    }

    activeIndexRef.current = next;
    if (activeIndex !== next) setActiveIndex(next);
  }, [activeIndex, ids, rows.length, selected]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = activeIndexRef.current;
    const row = rows[currentIndex];

    if (rows.length === 0 || !row) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(currentIndex + 1, event);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(currentIndex - 1, event);
        break;
      case 'ArrowRight':
        event.preventDefault();

        if (row.hasChildren && !row.expanded) setExpanded(row.id, true);
        else if (row.hasChildren) move(currentIndex + 1, event);

        break;
      case 'ArrowLeft': {
        event.preventDefault();

        if (row.hasChildren && row.expanded) {
          setExpanded(row.id, false);

          break;
        }

        // Sin nada que plegar, sube al padre: la fila anterior con menos sangría.
        for (let index = currentIndex - 1; index >= 0; index -= 1) {
          const candidate = rows[index];

          if (candidate && candidate.depth < row.depth) {
            move(index, event);
            break;
          }
        }

        break;
      }
      case 'Home':
        event.preventDefault();
        move(0, event);
        break;
      case 'End':
        event.preventDefault();
        move(rows.length - 1, event);
        break;
      case 'Enter':
        event.preventDefault();

        if (row.hasChildren) setExpanded(row.id, !row.expanded);
        else onActivate?.(row);

        break;
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

  const activeId = ids[activeIndex];

  return (
    <div
      ref={scrollRef}
      className={[styles.viewport, autoHeight ? styles.autoHeight : '', className]
        .filter(Boolean)
        .join(' ')}
      role="tree"
      aria-label={label}
      aria-multiselectable={selectionMode === 'multiple' ? true : undefined}
      aria-activedescendant={activeId === undefined ? undefined : `${baseId}${activeId}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={autoHeight ? { height: virtualizer.getTotalSize() } : undefined}
    >
      {rows.length === 0 ? (
        <div className={styles.empty}>{empty}</div>
      ) : (
        <div className={styles.canvas} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtual) => {
            const row = rows[virtual.index];

            if (!row) return null;

            const isSelected = selection.isSelected(row.id);
            const isActive = virtual.index === activeIndex;

            return (
              <div
                key={row.id}
                id={`${baseId}${row.id}`}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-setsize={row.setSize}
                aria-posinset={row.posInSet}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                aria-selected={selectable ? isSelected : undefined}
                className={styles.row}
                data-active={isActive ? '' : undefined}
                style={{
                  height: virtual.size,
                  transform: `translateY(${String(virtual.start)}px)`,
                  paddingLeft: `${String(row.depth * INDENT_STEP)}px`,
                }}
                onMouseDown={(event) => {
                  // Solo el clic izquierdo selecciona: el derecho abre el menú
                  // contextual sin cambiar la selección ni disparar el diff.
                  if (event.button !== 0) return;

                  activeIndexRef.current = virtual.index;
                  activeIdRef.current = row.id;
                  setActiveIndex(virtual.index);

                  if (selectable) selection.select(row.id, allIds, event);
                }}
                onClick={() => {
                  if (row.hasChildren) setExpanded(row.id, !row.expanded);
                }}
                onDoubleClick={() => {
                  if (!row.hasChildren) onActivate?.(row);
                }}
              >
                {row.hasChildren ? (
                  <span
                    className={styles.twisty}
                    data-expanded={row.expanded ? '' : undefined}
                    onMouseDown={(event) => {
                      // El triángulo solo pliega: sin esto, abrir una carpeta
                      // arrastraría con ello un cambio de selección.
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpanded(row.id, !row.expanded);
                    }}
                  >
                    <TwistyIcon />
                  </span>
                ) : (
                  <span className={styles.twisty} aria-hidden="true" />
                )}

                {renderNode ? (
                  renderNode(row, { selected: isSelected, active: isActive })
                ) : (
                  <span className={styles.label}>{row.label}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
