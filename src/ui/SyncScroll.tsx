import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import {
  mirroredOffset,
  SyncScrollContext,
  type SyncAxis,
  type SyncMode,
  type SyncScrollRegistry,
} from './syncScroll';

interface SyncScrollProps {
  axis?: SyncAxis;
  mode?: SyncMode;
  children: ReactNode;
}

/**
 * Ata el scroll de los `SyncScrollPane` que tenga dentro.
 *
 * Mover un panel por código dispara su propio evento de scroll, que intentaría
 * mover a los demás, que moverían al primero. Cortar ese ciclo es todo el
 * problema: sin cortarlo los paneles se persiguen, y con la rueda del ratón eso
 * se ve como un temblor que apenas avanza.
 *
 * **El corte no puede ir por reloj.** La primera versión levantaba una bandera
 * mientras propagaba y la soltaba en el siguiente fotograma; la rueda dispara
 * mucho más seguido que un fotograma, así que unas veces se tragaba un
 * desplazamiento de verdad —de ahí lo lento— y otras el eco llegaba con la
 * bandera ya baja y devolvía el panel casi a donde estaba —de ahí el temblor—.
 *
 * Lo que se hace ahora no depende del tiempo: **cada movimiento por código
 * anota dónde deja a su panel**, y el evento que ese movimiento provoca se
 * reconoce por la posición y se consume sin propagarse. Si el panel no llegó a
 * moverse —ya estaba al final— no se anota nada, porque tampoco va a haber
 * evento que consumir.
 *
 * **Y se escribe una vez por cuadro, no una por evento.** Escribir el scroll de
 * un panel hermano dentro del manejador obliga a pasar por el hilo principal, y
 * una rueda inercial manda muchos más eventos que cuadros tiene un segundo:
 * atendiéndolos todos, el navegador se queda atrás y la sensación es que cuanto
 * más rápido se gira, más despacio avanza. El primero de cada cuadro se atiende
 * en el acto —para que un desplazamiento suelto no espere a nada— y los que
 * llegan detrás solo apuntan quién mandó; al cerrar el cuadro se aplica **la
 * posición en la que ese panel haya quedado**, que es la única que importa.
 */
/** Un píxel de margen: el navegador redondea al asignar `scrollTop`. */
const SAME_POSITION = 1;

export function SyncScroll({ axis = 'vertical', mode = 'absolute', children }: SyncScrollProps) {
  const panesRef = useRef(new Set<HTMLElement>());
  /** Dónde dejó a cada panel la última propagación, para reconocer su eco. */
  const echoRef = useRef(new Map<HTMLElement, { top: number; left: number }>());
  /** El cuadro en el que ya se escribió, y quién mandó dentro de él. */
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<HTMLElement | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  /** Copia la posición de `source` a todos los demás paneles. */
  const apply = useCallback(
    (source: HTMLElement) => {
      for (const target of panesRef.current) {
        if (target === source) continue;

        // `scrollTop` y `scrollLeft` no fuerzan diseño: son la posición, no la
        // geometría. Lo que la fuerza es preguntar cuánto mide algo.
        const before = { top: target.scrollTop, left: target.scrollLeft };

        /*
         * En modo absoluto **no se mide nada**: se copia el desplazamiento y ya.
         * No es una optimización de adorno. Leer `scrollHeight` o `clientHeight`
         * dentro de un manejador de scroll obliga al navegador a recalcular el
         * diseño en ese instante, y el WebKit de la ventana desplaza en el hilo
         * principal: cada medida frena la inercia de la rueda, y cuanto más
         * rápido se gira más veces se frena. De ahí que girar fuerte se sintiera
         * **más lento** que girar despacio.
         */
        if (axis === 'vertical' || axis === 'both') {
          target.scrollTop =
            mode === 'absolute'
              ? source.scrollTop
              : mirroredOffset(
                  {
                    scroll: source.scrollTop,
                    scrollSize: source.scrollHeight,
                    clientSize: source.clientHeight,
                  },
                  { scrollSize: target.scrollHeight, clientSize: target.clientHeight },
                  mode,
                );
        }

        if (axis === 'horizontal' || axis === 'both') {
          target.scrollLeft =
            mode === 'absolute'
              ? source.scrollLeft
              : mirroredOffset(
                  {
                    scroll: source.scrollLeft,
                    scrollSize: source.scrollWidth,
                    clientSize: source.clientWidth,
                  },
                  { scrollSize: target.scrollWidth, clientSize: target.clientWidth },
                  mode,
                );
        }

        /*
         * Se anota **la posición en la que quedó**, no la que se pidió: el
         * navegador redondea y recorta contra los extremos. Y si no se movió
         * —ya estaba donde tenía que estar— no se anota nada, porque no habrá
         * evento que consumir y la anotación se quedaría ahí para tragarse el
         * siguiente desplazamiento de verdad.
         */
        const moved =
          Math.abs(target.scrollTop - before.top) >= SAME_POSITION ||
          Math.abs(target.scrollLeft - before.left) >= SAME_POSITION;

        if (moved) {
          echoRef.current.set(target, { top: target.scrollTop, left: target.scrollLeft });
        } else {
          echoRef.current.delete(target);
        }
      }
    },
    [axis, mode],
  );

  const registry = useMemo<SyncScrollRegistry>(
    () => ({
      register(pane) {
        panesRef.current.add(pane);

        return () => {
          panesRef.current.delete(pane);
          echoRef.current.delete(pane);
        };
      },

      broadcast(source) {
        const echo = echoRef.current.get(source);

        /*
         * El eco de lo que acabamos de mover no se vuelve a propagar. Se
         * reconoce por la posición y no por el momento en que llega, así que da
         * igual cuántos eventos traiga la rueda en un mismo fotograma.
         *
         * **La anotación no se borra al reconocerlo**, y esto es lo que hacía
         * falta para una rueda que gira muy rápido: si el origen se mueve dos
         * veces antes de que lleguen los ecos, el panel de al lado acaba en la
         * segunda posición y **los dos** ecos llegan con esa misma cifra.
         * Borrándola en el primero, el segundo pasaba por desplazamiento de
         * verdad y devolvía el origen — el resto de temblor que quedaba. La
         * anotación se va sola en cuanto llega una posición distinta, que es
         * justo lo que hace la mano.
         */
        if (
          echo &&
          Math.abs(source.scrollTop - echo.top) < SAME_POSITION &&
          Math.abs(source.scrollLeft - echo.left) < SAME_POSITION
        ) {
          return;
        }

        echoRef.current.delete(source);

        // Ya se escribió en este cuadro: este solo apunta quién manda ahora, y
        // al cerrarlo se aplica donde haya quedado.
        if (frameRef.current !== null) {
          pendingRef.current = source;

          return;
        }

        apply(source);

        if (typeof requestAnimationFrame !== 'function') return;

        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;

          const pending = pendingRef.current;

          pendingRef.current = null;

          if (pending && panesRef.current.has(pending)) apply(pending);
        });
      },
    }),
    [apply],
  );

  return <SyncScrollContext value={registry}>{children}</SyncScrollContext>;
}
