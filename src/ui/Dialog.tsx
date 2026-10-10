import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { IconButton } from './IconButton';
import styles from './Dialog.module.css';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Frase que dice de qué va el diálogo. Nombra siempre sus ramas. */
  title: string;
  /**
   * Lo que se pierde, dicho exactamente. Es obligatorio en todo diálogo
   * destructivo: la invariante 2 no admite «¿seguro?» a secas.
   */
  description?: string;
  /** Etiqueta accesible del botón de cerrar. */
  closeLabel: string;
  size?: 'sm' | 'md' | 'lg';
  /** Acciones del pie, ya ordenadas: la principal a la derecha. */
  footer?: ReactNode;
  children?: ReactNode;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Diálogo modal con foco atrapado y pila.
 *
 * Atrapa el foco porque mientras hay un modal no hay nada más que hacer, y
 * devuelve el foco a lo que lo tenía al cerrarse. Escape cierra solo el de
 * arriba: el evento se detiene aquí y no llega a los de abajo. La pila no lleva
 * cuenta de profundidades — cada diálogo sale en su propio portal y el orden de
 * montaje ya decide cuál tapa a cuál.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  closeLabel,
  size = 'md',
  footer,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;

    returnFocusTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    const requested =
      document.activeElement instanceof HTMLElement && panel?.contains(document.activeElement)
        ? document.activeElement
        : null;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);

    (requested ?? first ?? panel)?.focus({ preventScroll: true });

    return () => {
      returnFocusTo.current?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();

      return;
    }

    if (event.key !== 'Tab') return;

    const panel = panelRef.current;

    if (!panel) return;

    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (!first || !last) return;

    // El foco da la vuelta dentro del panel: nunca se escapa a la vista de atrás.
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={styles.scrim} onKeyDown={onKeyDown}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={[styles.panel, styles[size]].join(' ')}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <IconButton icon={<CloseIcon />} aria-label={closeLabel} onClick={onClose} />
        </header>

        {description && (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        )}

        {children && <div className={styles.body}>{children}</div>}
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
