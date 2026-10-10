import { useEffect, type RefObject } from 'react';

/**
 * Zona de proximidad al borde, en píxeles.
 *
 * Cuando el puntero entra en esta franja durante un arrastre, el contenedor
 * empieza a scrollear en esa dirección. Cuanto más cerca del borde, más rápido.
 */
const EDGE_ZONE = 48;

/** Velocidad máxima de scroll, en píxeles por evento `dragover`. */
const MAX_SPEED = 12;

/**
 * Auto-scroll durante arrastre nativo.
 *
 * El WebKit de la ventana Tauri no reparte `requestAnimationFrame` ni
 * `setTimeout` dentro del bucle de arrastre, así que la única señal periódica
 * fiable es `dragover`, que el navegador dispara continuamente mientras algo se
 * arrastra sobre el elemento. Cada disparo mueve el scroll un poco si el
 * puntero está en la franja de proximidad.
 *
 * La velocidad es proporcional a la cercanía al borde: justo en el límite de la
 * zona casi no se mueve; pegado al borde se mueve a `MAX_SPEED`.
 */
export function useDragAutoScroll(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const onDragOver = (event: DragEvent) => {
      const rect = container.getBoundingClientRect();
      const y = event.clientY;

      const distanceFromTop = y - rect.top;
      const distanceFromBottom = rect.bottom - y;

      if (distanceFromTop < EDGE_ZONE) {
        // Proporción: 1 en el borde, 0 en el límite de la zona.
        const ratio = 1 - distanceFromTop / EDGE_ZONE;

        container.scrollBy(0, -Math.ceil(ratio * MAX_SPEED));
      } else if (distanceFromBottom < EDGE_ZONE) {
        const ratio = 1 - distanceFromBottom / EDGE_ZONE;

        container.scrollBy(0, Math.ceil(ratio * MAX_SPEED));
      }
    };

    container.addEventListener('dragover', onDragOver);

    return () => {
      container.removeEventListener('dragover', onDragOver);
    };
  }, [containerRef]);
}
