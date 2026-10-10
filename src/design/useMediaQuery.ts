import { useCallback, useSyncExternalStore } from 'react';

/**
 * Sigue una consulta de medios y repinta cuando cambia.
 *
 * `useSyncExternalStore` en vez de estado más efecto porque el primer pintado ya
 * necesita el valor correcto: si el sistema pide modo claro, la ventana no debe
 * abrir en oscuro y corregirse un fotograma después.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);

      list.addEventListener('change', onChange);

      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
