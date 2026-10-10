import { useEffect } from 'react';

/**
 * Cuánto mide una «línea» y una «página» de rueda cuando el evento no las da
 * en píxeles. La línea es una aproximación deliberada —el alto real depende de
 * la fuente— y la página se resuelve con el alto del propio contenedor.
 */
const LINE_HEIGHT = 16;

/**
 * Desplaza un contenedor con la rueda **sin dejársela al navegador**.
 *
 * Existe por el WebKit de la ventana, y es de las cosas que solo se descubren
 * abriéndola: ese motor anima el desplazamiento de la rueda por su cuenta y lo
 * hace en el hilo principal. Con una rueda inercial —de las que giran solas—
 * cada ráfaga de eventos reinicia la animación anterior antes de que termine,
 * así que **cuanto más rápido se gira, menos avanza**. En Chrome no pasa: por
 * eso el fallo no aparecía en `npm run dev` y sí en `npm run tauri dev`.
 *
 * Aquí la rueda se convierte en desplazamiento directo, uno a uno: lo que gira
 * el dedo es lo que se mueve el contenedor, sin animación que interrumpir. No
 * es una preferencia de estilo — es la única forma de que el gesto responda
 * igual en los dos motores.
 *
 * **Lo que no toca:** el zoom (`Ctrl` + rueda), que es del navegador; el
 * desplazamiento horizontal, que se copia tal cual; y cualquier contenedor que
 * no pueda desplazarse en esa dirección, donde el evento sigue su camino para
 * que lo aproveche el de más afuera.
 *
 * Recibe el elemento y no una `ref` a propósito: el contenedor de un editor
 * aparece después del primer pintado, y con una `ref` el efecto no se entera de
 * que ya está.
 */
export function useDirectWheel(element: HTMLElement | null, enabled = true): void {
  useEffect(() => {
    if (!element || !enabled) return;

    const onWheel = (event: WheelEvent) => {
      // El zoom del navegador no se toca.
      if (event.ctrlKey || event.metaKey) return;

      const factor =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_HEIGHT
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientHeight
            : 1;

      const dy = event.deltaY * factor;
      const dx = event.deltaX * factor;

      const canVertical =
        dy !== 0 &&
        element.scrollHeight > element.clientHeight &&
        !(dy < 0 && element.scrollTop <= 0) &&
        !(dy > 0 && element.scrollTop >= element.scrollHeight - element.clientHeight - 1);

      const canHorizontal =
        dx !== 0 &&
        element.scrollWidth > element.clientWidth &&
        !(dx < 0 && element.scrollLeft <= 0) &&
        !(dx > 0 && element.scrollLeft >= element.scrollWidth - element.clientWidth - 1);

      // En el borde, el evento sigue su camino: así la rueda pasa al contenedor
      // de más afuera en vez de morir aquí.
      if (!canVertical && !canHorizontal) return;

      event.preventDefault();

      if (canVertical) element.scrollTop += dy;
      if (canHorizontal) element.scrollLeft += dx;
    };

    // Sin `passive`, que es lo que permite quedarse con el evento.
    element.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [element, enabled]);
}
