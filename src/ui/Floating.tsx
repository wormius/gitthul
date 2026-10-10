import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import {
  anchorRect,
  placeFloating,
  type FloatingAlign,
  type FloatingAnchor,
  type FloatingSide,
  type Placement,
} from './floatingUtils';
import styles from './Floating.module.css';

interface FloatingProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  anchor: FloatingAnchor;
  side?: FloatingSide;
  align?: FloatingAlign;
  gap?: number;
  margin?: number;
  /** Ajusta el ancho al elemento de anclaje, limitado por la ventana. */
  matchAnchorWidth?: boolean;
  /** Se expone para que quien abre la capa pueda mirar dentro: foco, cierre, medidas. */
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

/**
 * Capa posicionada fuera del flujo, en un portal sobre `document.body`.
 *
 * Es la base de menús, popovers y tooltips, y la razón por la que ninguno de
 * ellos desplaza la interfaz: nada de lo que aparece vive dentro del documento
 * que lo invoca. Se pinta invisible hasta tener su medida, porque colocarla
 * exige saber cuánto ocupa y un fotograma en la esquina se vería como un salto.
 */
export function Floating({
  anchor,
  side = 'bottom',
  align = 'start',
  gap = 4,
  margin = 8,
  matchAnchorWidth = false,
  panelRef,
  className,
  children,
  ...rest
}: FloatingProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const reposition = useCallback(() => {
    const node = ownRef.current;

    if (!node) return;

    const rect = anchorRect(anchor);
    if (matchAnchorWidth && anchor instanceof HTMLElement) {
      node.style.minWidth = '0';
      node.style.maxWidth = `${Math.max(0, window.innerWidth - margin * 2)}px`;
      node.style.width = `${rect.width}px`;
    }

    const next = placeFloating({
      anchor: rect,
      floating: { width: node.offsetWidth, height: node.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      side,
      align,
      gap,
      margin,
    });

    // Comparar antes de escribir evita el ciclo cuando el anclaje es un punto
    // recién creado en cada render, que es el caso del menú contextual.
    setPlacement((previous) =>
      previous && previous.x === next.x && previous.y === next.y && previous.side === next.side
        ? previous
        : next,
    );
  }, [anchor, side, align, gap, margin, matchAnchorWidth]);

  useLayoutEffect(() => {
    if (panelRef) panelRef.current = ownRef.current;
  });

  useLayoutEffect(reposition, [reposition]);

  useEffect(() => {
    window.addEventListener('resize', reposition);
    // En captura: también interesa el scroll de cualquier panel intermedio.
    window.addEventListener('scroll', reposition, true);
    const observer =
      matchAnchorWidth && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(reposition)
        : null;
    if (observer && anchor instanceof HTMLElement) observer.observe(anchor);
    if (observer && ownRef.current) observer.observe(ownRef.current);

    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      observer?.disconnect();
    };
  }, [reposition, matchAnchorWidth, anchor]);

  return createPortal(
    <div
      ref={ownRef}
      className={[styles.floating, className].filter(Boolean).join(' ')}
      data-side={placement?.side ?? side}
      style={{
        transform: `translate(${String(placement?.x ?? 0)}px, ${String(placement?.y ?? 0)}px)`,
        visibility: placement ? 'visible' : 'hidden',
      }}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  );
}
