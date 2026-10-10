import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { usePersistentSize } from './paneStorage';
import styles from './SplitPane.module.css';

export type SplitOrientation = 'horizontal' | 'vertical';

interface SplitPaneProps {
  /**
   * Cómo se reparten los paneles: `horizontal` los pone uno al lado del otro
   * (el divisor queda vertical) y `vertical` uno encima del otro.
   */
  orientation?: SplitOrientation;
  /** Nombre accesible del divisor, p. ej. «Ancho del panel de ramas». */
  label: string;
  /** Identidad con la que se recuerda el reparto. Sin ella vive solo en memoria. */
  storageId?: string;
  /** Fracción del primer panel, de 0 a 1. */
  defaultRatio?: number;
  /** Controlado desde fuera. Cuando se pasa, `onRatioChange` es obligatorio. */
  ratio?: number;
  onRatioChange?: (ratio: number) => void;
  /** Mínimos en píxeles. El arrastre no baja de ellos. */
  minFirst?: number;
  minSecond?: number;
  /** Aplica los mínimos también al restaurar el reparto o redimensionar el contenedor. */
  enforceMinimumSizes?: boolean;
  /** Qué panel puede plegarse. El divisor lo hace con doble clic o con Enter. */
  collapsible?: 'first' | 'second';
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * A qué queda reducido el panel plegado. Con `0` desaparece y queda fuera del
   * alcance del teclado; con `'content'` se encoge hasta lo que ocupe lo que
   * tenga dentro, que es el caso del panel que se pliega a una tira de iconos y
   * sigue siendo usable.
   */
  collapsedSize?: number | 'content';
  first: ReactNode;
  second: ReactNode;
  className?: string;
  /** Saca ambos paneles y el divisor de toda interacción durante una operación bloqueante. */
  inert?: boolean;
}

const KEYBOARD_STEP = 0.02;

function clamp(value: number, low: number, high: number): number {
  if (low > high) return (low + high) / 2;

  return Math.min(Math.max(value, low), high);
}

/**
 * Dos paneles redimensionables, anidables en cualquier combinación.
 *
 * El reparto se guarda como fracción y no como píxeles: es lo que hace que al
 * agrandar la ventana los paneles crezcan en proporción en vez de dejar todo el
 * espacio nuevo a uno solo. Los mínimos sí van en píxeles, porque lo que no cabe
 * en un panel es contenido real y no una fracción.
 *
 * El divisor es un `separator` con foco propio: arrastrarlo y moverlo con las
 * flechas son el mismo gesto por dos caminos, como exige la invariante 3.
 */
export function SplitPane({
  orientation = 'horizontal',
  label,
  storageId,
  defaultRatio = 0.5,
  ratio: controlledRatio,
  onRatioChange,
  minFirst = 120,
  minSecond = 120,
  enforceMinimumSizes = false,
  collapsible,
  collapsed = false,
  onCollapsedChange,
  collapsedSize = 0,
  first,
  second,
  className,
  inert = false,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Sin `storageId` el mismo gancho sirve de estado a secas: no escribe nada.
  const [uncontrolledRatio, setUncontrolledRatio] = usePersistentSize(storageId, defaultRatio);
  const [dragging, setDragging] = useState(false);

  const ratio = controlledRatio ?? uncontrolledRatio;

  const applyRatio = useCallback(
    (compute: (current: number) => number) => {
      const next =
        controlledRatio === undefined
          ? setUncontrolledRatio((current) => compute(current))
          : compute(controlledRatio);

      onRatioChange?.(next);
    },
    [controlledRatio, onRatioChange, setUncontrolledRatio],
  );

  const horizontal = orientation === 'horizontal';

  const clampRatio = (value: number) => {
    const node = containerRef.current;
    const total = horizontal ? node?.clientWidth : node?.clientHeight;
    if (!node || !total) return clamp(value, 0.05, 0.95);
    const divider = node.children[1] as HTMLElement;
    const available = total - (horizontal ? divider.offsetWidth : divider.offsetHeight);
    if (available <= 0) return ratio;
    return clamp(value, minFirst / available, 1 - minSecond / available);
  };

  /** Convierte una posición del puntero en fracción, respetando los mínimos. */
  const ratioAt = useCallback(
    (clientX: number, clientY: number): number | null => {
      const node = containerRef.current;

      if (!node) return null;

      const box = node.getBoundingClientRect();
      const divider = node.children[1] as HTMLElement;
      const total =
        (horizontal ? box.width : box.height) -
        (horizontal ? divider.offsetWidth : divider.offsetHeight);

      if (total <= 0) return null;

      const offset = horizontal ? clientX - box.left : clientY - box.top;

      return clamp(offset / total, minFirst / total, 1 - minSecond / total);
    },
    [horizontal, minFirst, minSecond],
  );

  const toggleCollapsed = useCallback(() => {
    if (!collapsible) return;

    onCollapsedChange?.(!collapsed);
  }, [collapsed, collapsible, onCollapsedChange]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || collapsed) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;

    const next = ratioAt(event.clientX, event.clientY);

    if (next !== null) applyRatio(() => next);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const increase = horizontal ? 'ArrowRight' : 'ArrowDown';

    if (event.key === 'Enter' || event.key === ' ') {
      if (!collapsible) return;

      event.preventDefault();
      toggleCollapsed();

      return;
    }

    if (collapsed) return;

    const step =
      event.key === decrease ? -KEYBOARD_STEP : event.key === increase ? KEYBOARD_STEP : 0;

    if (step !== 0) {
      event.preventDefault();
      applyRatio((current) => clampRatio(current + step));

      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      applyRatio(() => clampRatio(0.05));
    } else if (event.key === 'End') {
      event.preventDefault();
      applyRatio(() => clampRatio(0.95));
    }
  };

  const firstCollapsed = collapsed && collapsible === 'first';
  const secondCollapsed = collapsed && collapsible === 'second';
  const percentage = `${String(Math.round(ratio * 10000) / 100)}%`;

  // Un panel plegado a cero no debe poder recibir el foco; uno plegado a su
  // contenido sigue siendo parte de la interfaz y tiene que seguir siendo usable.
  const vanished = collapsedSize === 0;
  const collapsedBasis = collapsedSize === 'content' ? 'auto' : collapsedSize;

  return (
    <div
      ref={containerRef}
      className={[styles.split, styles[orientation], dragging ? styles.dragging : '', className]
        .filter(Boolean)
        .join(' ')}
      inert={inert}
    >
      <div
        className={[styles.pane, firstCollapsed ? styles.collapsed : ''].filter(Boolean).join(' ')}
        style={{
          flexBasis: firstCollapsed ? collapsedBasis : percentage,
          flexGrow: secondCollapsed ? 1 : 0,
          [horizontal ? 'minWidth' : 'minHeight']:
            enforceMinimumSizes && !firstCollapsed ? minFirst : undefined,
        }}
        inert={firstCollapsed && vanished}
      >
        {first}
      </div>

      <div
        role="separator"
        aria-label={label}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        className={styles.divider}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={toggleCollapsed}
        onKeyDown={onKeyDown}
      >
        <span className={styles.grip} aria-hidden="true" />
      </div>

      <div
        className={[styles.pane, styles.rest, secondCollapsed ? styles.collapsed : '']
          .filter(Boolean)
          .join(' ')}
        style={
          secondCollapsed
            ? { flexBasis: collapsedBasis }
            : {
                [horizontal ? 'minWidth' : 'minHeight']: enforceMinimumSizes
                  ? minSecond
                  : undefined,
              }
        }
        inert={secondCollapsed && vanished}
      >
        {second}
      </div>
    </div>
  );
}
