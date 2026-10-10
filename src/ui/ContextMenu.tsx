import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

import { Menu } from './Menu';
import type { MenuEntry } from './menu';
import styles from './ContextMenu.module.css';

interface ContextMenuProps {
  items: readonly MenuEntry[];
  /** Nombre accesible del menú. */
  label: string;
  /**
   * Sobre qué opera el menú. Con selección múltiple es obligatorio decirlo:
   * «3 commits seleccionados» delante de «Cherry-pick de 3 commits sobre main».
   */
  description?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Qué es la región en el árbol de accesibilidad.
   *
   * Por defecto, nada: es una caja más. `presentation` sirve donde la región se
   * interpone entre dos roles que tienen que seguir siendo padre e hijo — una
   * fila dentro de un `rowgroup`, por ejemplo.
   */
  role?: 'presentation';
  children: ReactNode;
}

/**
 * Región que abre un menú donde se pulse con el botón derecho.
 *
 * El menú también sale con la tecla de menú contextual y con Mayús+F10, porque
 * el clic derecho no existe en teclado y este es el camino por defecto de casi
 * cualquier acción. En ese caso se ancla al centro de la región y no al cursor,
 * que en teclado no significa nada.
 */
export function ContextMenu({
  items,
  label,
  description,
  disabled,
  className,
  role,
  children,
}: ContextMenuProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  const close = () => {
    setPoint(null);
    // El foco vuelve a lo que lo tenía dentro de la región, no a `body`.
    regionRef.current?.focus({ preventScroll: true });
  };

  /*
   * El menú más cercano al puntero es el único que abre.
   *
   * Las regiones se anidan a propósito —la tarjeta dentro de su zona, la zona
   * dentro del panel— y cada una ofrece lo suyo. Sin detener la propagación, un
   * clic derecho sobre la tarjeta abría los tres menús encimados, y el que se
   * leía encima era el del contenedor: justo el menos específico de los tres.
   */
  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || items.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    setPoint({ x: event.clientX, y: event.clientY });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || items.length === 0) return;
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;

    const target = event.target instanceof HTMLElement ? event.target : regionRef.current;
    const rect = target?.getBoundingClientRect();

    event.preventDefault();
    event.stopPropagation();
    setPoint(
      rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 },
    );
  };

  return (
    <div
      ref={regionRef}
      tabIndex={-1}
      role={role}
      className={[styles.region, className].filter(Boolean).join(' ')}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      {children}
      {point && (
        <Menu
          items={items}
          label={label}
          description={description}
          anchor={point}
          side="bottom"
          align="start"
          onClose={close}
        />
      )}
    </div>
  );
}
