import { useEffect, useRef } from 'react';

/**
 * Cierra una capa flotante al pulsar fuera de ella.
 *
 * Escucha `pointerdown` y no `click` porque lo que cierra un menú es empezar a
 * pulsar en otro sitio: esperar al `click` deja la capa abierta mientras se
 * arrastra, y el arrastre de ramas es un gesto de primera clase en GitWorking.
 *
 * El Escape no vive aquí: lo maneja cada capa en su propio `onKeyDown`, que es
 * lo que permite que en un submenú cierre solo el submenú.
 */
export function useOutsidePointer(
  active: boolean,
  onOutside: () => void,
  isInside: (target: Node) => boolean,
) {
  const handlers = useRef({ onOutside, isInside });

  useEffect(() => {
    handlers.current = { onOutside, isInside };
  });

  useEffect(() => {
    if (!active) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Node && handlers.current.isInside(target)) return;

      handlers.current.onOutside();
    };

    document.addEventListener('pointerdown', onPointerDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [active]);
}
