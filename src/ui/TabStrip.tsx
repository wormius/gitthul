import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Tab, type TabDescriptor } from './Tab';
import styles from './TabStrip.module.css';

interface TabStripProps {
  /** Nombre accesible de la tira. */
  label: string;
  tabs: readonly TabDescriptor[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** La pestaña `id` pasa a ocupar la posición `toIndex`. */
  onReorder: (id: string, toIndex: number) => void;
}

/**
 * La tira de pestañas, reordenable arrastrando.
 *
 * Soltar sobre una pestaña deja la arrastrada en el puesto de esa: no hay
 * «antes» y «después» según de qué lado del centro se suelte, porque con
 * pestañas estrechas ese medio píxel decide mal la mitad de las veces. Mientras
 * dura el arrastre, la pestaña de origen se queda fantasmal en su hueco y la de
 * destino marca su borde: las dos mitades de «esto va de aquí a allí». El teclado
 * reordena desde la búsqueda global, sin reservar otros dos atajos.
 *
 * No es un `tablist`: estas pestañas no revelan paneles hermanos, sustituyen la
 * vista entera y llevan botones dentro, que es justo lo que un `tablist` no
 * admite. Es una lista, y la activa se marca con `aria-current`.
 */
export function TabStrip({ label, tabs, activeId, onActivate, onClose, onReorder }: TabStripProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [ghost, setGhost] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const ghostFrame = useRef<number | null>(null);

  /*
   * La pestaña activa siempre a la vista. Con la tira desplazada, cambiar de
   * pestaña por atajo la dejaría activa y fuera de la ventana, que es la peor
   * combinación posible: la vista cambió y no se ve dónde estás.
   */
  useEffect(() => {
    if (activeId === null) return;

    buttons.current.get(activeId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs]);

  /*
   * El fantasma llega un cuadro tarde a propósito. El navegador saca la foto que
   * viaja con el puntero justo después del manejador de `dragstart`, así que
   * atenuar la pestaña ahí atenuaría también esa foto: se vería mover algo casi
   * invisible. Un cuadro después, la foto ya está tomada. Lo que sí se marca en el
   * acto es `dragging`, que es de lógica y no de pintura.
   */
  const startDrag = (id: string) => {
    setDragging(id);
    ghostFrame.current = requestAnimationFrame(() => {
      setGhost(id);
    });
  };

  const endDrag = () => {
    if (ghostFrame.current !== null) cancelAnimationFrame(ghostFrame.current);

    ghostFrame.current = null;
    setDragging(null);
    setGhost(null);
    setOver(null);
  };

  useEffect(() => endDrag, []);

  const drop = (targetId: string) => {
    const toIndex = tabs.findIndex((tab) => tab.id === targetId);

    if (dragging !== null && dragging !== targetId && toIndex !== -1) {
      onReorder(dragging, toIndex);
    }

    endDrag();
  };

  // Las flechas recorren la tira sin activar nada: mirar antes de saltar.
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number) => {
    if (
      event.defaultPrevented ||
      (event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, [contenteditable="true"]'))
    ) {
      return;
    }

    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

    if (step === 0 && event.key !== 'Home' && event.key !== 'End') return;

    const target =
      event.key === 'Home'
        ? tabs[0]
        : event.key === 'End'
          ? tabs[tabs.length - 1]
          : tabs[(index + step + tabs.length) % tabs.length];

    if (!target) return;

    event.preventDefault();
    buttons.current.get(target.id)?.focus();
  };

  return (
    <ul className={styles.strip} aria-label={label}>
      {tabs.map((tab, index) => (
        <Tab
          key={tab.id}
          ref={(node) => {
            if (node) buttons.current.set(tab.id, node);
            else buttons.current.delete(tab.id);
          }}
          tab={tab}
          active={tab.id === activeId}
          dragging={ghost === tab.id}
          dropTarget={over === tab.id && dragging !== null && dragging !== tab.id}
          onActivate={() => {
            onActivate(tab.id);
          }}
          onClose={() => {
            onClose(tab.id);
          }}
          onDragStart={() => {
            startDrag(tab.id);
          }}
          onDragOver={() => {
            setOver(tab.id);
          }}
          onDragEnd={endDrag}
          onDrop={() => {
            drop(tab.id);
          }}
          onKeyDown={(event) => {
            onKeyDown(event, index);
          }}
        />
      ))}
    </ul>
  );
}
