import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { DragLayerContext, type DragLayerApi, type DragSession } from './dragLayer';

interface DragLayerProps {
  children: ReactNode;
}

/**
 * La capa que sostiene un arrastre de principio a fin.
 *
 * No pinta nada por sí misma —envolver algo en una capa que ocupara sitio
 * desplazaría lo de dentro, que es justo lo que la invariante 1 prohíbe—: lo que
 * hace es repartir una sola sesión entre el origen (`useDragSource`) y los
 * destinos (`useDropTarget`), y ser la única que sabe cuándo empieza y cuándo
 * termina de verdad. El resalte lo pinta cada destino sobre su propio elemento,
 * con la clase que le da la capa, y solo con `opacity`, `background-color` y
 * `outline`, ninguno de los cuales ocupa espacio.
 *
 * **Los tres oyentes viven en `document` y en captura.** El arrastre nativo
 * corre en un bucle de eventos propio: dentro no llegan ni relojes ni cuadros de
 * animación, y el puntero puede salirse de cualquier elemento de React sin
 * avisar. `dragover` es lo único que llega sin parar, y `dragend` el único aviso
 * seguro de que aquello terminó. `drop` se escucha en burbuja, no en captura,
 * porque en captura llegaría **antes** que el destino y apagaría la sesión que
 * ese destino está a punto de leer.
 */
export function DragLayer({ children }: DragLayerProps) {
  const [session, setSession] = useState<DragSession | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const end = useCallback(() => {
    detachRef.current?.();
    detachRef.current = null;
    setSession(null);
    setOver(null);
  }, []);

  const begin = useCallback(
    (source: string, payload: unknown) => {
      // Un arrastre que no llegó a su `dragend` —el puntero salió de la ventana,
      // el origen se desmontó— no puede dejar sus oyentes colgados.
      detachRef.current?.();

      function reveal() {
        document.removeEventListener('dragover', reveal, true);
        setSession((current) =>
          current === null || current.revealed ? current : { ...current, revealed: true },
        );
      }

      function finish() {
        end();
      }

      document.addEventListener('dragover', reveal, true);
      document.addEventListener('dragend', finish, true);
      document.addEventListener('drop', finish);

      detachRef.current = () => {
        document.removeEventListener('dragover', reveal, true);
        document.removeEventListener('dragend', finish, true);
        document.removeEventListener('drop', finish);
      };

      setSession({ source, payload, revealed: false });
    },
    [end],
  );

  const hover = useCallback((target: string) => {
    setOver(target);
  }, []);

  const unhover = useCallback((target: string) => {
    // Pasar de un destino al de al lado dispara el `dragenter` del nuevo antes
    // que el `dragleave` del viejo: apagar a ciegas apagaría el recién encendido.
    setOver((current) => (current === target ? null : current));
  }, []);

  useEffect(() => () => detachRef.current?.(), []);

  const api = useMemo<DragLayerApi>(
    () => ({ session, over, begin, end, hover, unhover }),
    [session, over, begin, end, hover, unhover],
  );

  return <DragLayerContext value={api}>{children}</DragLayerContext>;
}
