import { useEffect, useMemo, type ReactNode } from 'react';

import { useRepositoryGestureDefinitions } from '@features/repositories/repositoryGestures';
import { useResolveGestureDefinitions } from '@features/resolve/resolveGestures';
import { useWorkingGestureDefinitions } from '@features/working/workingGestures';

import { GestureContext } from './GestureContext';
import { createGestureRegistry } from './gestures';
import { detectPlatform, type Platform } from './platform';
import { useShellGestureDefinitions } from './shellGestures';

interface GestureProviderProps {
  children: ReactNode;
  /** Útil en pruebas: fija la plataforma sin tocar el `userAgent`. */
  platform?: Platform;
}

/**
 * Monta el registro de gestos y la escucha global de teclado.
 *
 * La escucha va en `window` y en fase de burbujeo, la última de la cadena: lo
 * que un menú, un diálogo o la paleta ya atendieron detiene el evento antes de
 * llegar aquí. Los controles locales conservan la prioridad sobre los atajos de
 * aplicación.
 *
 * La escucha se vuelve a instalar cada vez que el registro cambia — y cambia con
 * el idioma y con la pestaña activa, que deciden rótulos y qué está habilitado.
 * Es un solo `addEventListener` en `window`: sale más barato que sostener el
 * registro en una ref, y no hay ventana en la que se escuche uno viejo.
 *
 * **El registro se compone, no se hereda.** Los gestos del shell se concatenan
 * con los de cada vista, que los declara en su propia carpeta: así la búsqueda
 * global sigue siendo completa, sigue habiendo un solo registro, y la
 * comprobación de atajos repetidos se hace sobre el total y no vista por vista.
 */
export function GestureProvider({ children, platform }: GestureProviderProps) {
  const shell = useShellGestureDefinitions();
  const repositories = useRepositoryGestureDefinitions();
  const working = useWorkingGestureDefinitions();
  const resolve = useResolveGestureDefinitions();
  const resolvedPlatform = useMemo(() => platform ?? detectPlatform(), [platform]);

  const registry = useMemo(
    () =>
      createGestureRegistry([...shell, ...repositories, ...working, ...resolve], resolvedPlatform),
    [repositories, resolve, resolvedPlatform, shell, working],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const gesture = registry.match(event);

      if (!gesture) return;

      // Ctrl+P imprimiría, F1 abriría la ayuda del webview: lo que el registro
      // reclama, el navegador no lo ve.
      event.preventDefault();
      gesture.run();
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [registry]);

  return <GestureContext.Provider value={registry}>{children}</GestureContext.Provider>;
}
