import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

import type { FloatingAlign, FloatingSide } from './floating';
import { Floating } from './Floating';
import styles from './Popover.module.css';
import { useOutsidePointer } from './useOutsidePointer';

interface PopoverProps {
  open: boolean;
  /** Elemento del que cuelga. Nulo mientras el disparador no está montado. */
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Nombre accesible del panel. */
  label: string;
  side?: FloatingSide;
  align?: FloatingAlign;
  /** Lleva el foco dentro al abrir. Se apaga en los que salen por hover. */
  autoFocus?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Panel flotante libre, anclado a un elemento y controlado desde fuera.
 *
 * A diferencia del diálogo no atrapa el foco ni tapa la ventana: es lo que
 * usan las etiquetas de rama colapsadas o una vista previa, donde seguir viendo
 * lo de detrás es la mitad del sentido. Al cerrarse devuelve el foco al
 * anclaje, para no dejar el teclado en `body`.
 */
export function Popover({
  open,
  anchor,
  onClose,
  label,
  side = 'bottom',
  align = 'start',
  autoFocus = true,
  className,
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useOutsidePointer(
    open,
    onClose,
    (target) => Boolean(panelRef.current?.contains(target)) || Boolean(anchor?.contains(target)),
  );

  useEffect(() => {
    if (open && autoFocus) panelRef.current?.focus({ preventScroll: true });
  }, [open, autoFocus]);

  if (!open || !anchor) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;

    event.stopPropagation();
    onClose();
    anchor.focus({ preventScroll: true });
  };

  return (
    <Floating
      anchor={anchor}
      side={side}
      align={align}
      panelRef={panelRef}
      className={[styles.panel, className].filter(Boolean).join(' ')}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {children}
    </Floating>
  );
}
