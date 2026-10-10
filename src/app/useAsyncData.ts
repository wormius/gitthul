import { useCallback, useEffect, useState } from 'react';

import { isCancelled, toGitOperationError, type GitOperationError } from '@core/domain/errors';
import type { GitQuery } from '@core/ports/GitPort';

export type AsyncData<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'failed'; error: GitOperationError };

interface ReloadOptions {
  /** Conserva el dato visible mientras llega una foto nueva del mismo recurso. */
  retain?: boolean;
}

interface AsyncDataOptions<T> {
  /** Misma clave: refresca sin desmontar el dato visible. Otra clave: carga desde cero. */
  resourceKey?: string;
  /** Comparador estable: conserva la identidad del dato si una lectura no contiene cambios. */
  isEqual?: (previous: T, next: T) => boolean;
}

/**
 * Pedirle algo a un puerto sin bloquear la interfaz.
 *
 * Es la forma en que toda vista consume `GitPort`, y encierra las tres reglas
 * que si no habría que repetir en cada una:
 *
 * - **Se cancela al desmontar.** La consulta recibe una señal y se aborta
 *   cuando el componente se va; la respuesta que llegue tarde no escribe en un
 *   estado que ya no existe.
 * - **Cancelar no es fallar.** Cambiar de pestaña aborta lo que se estaba
 *   pidiendo y eso no pinta ningún panel de error.
 * - **Todo error llega tipado.** Lo que se atrape, sea lo que sea, entra al
 *   catálogo, así que la vista siempre tiene un `GitOperationError` que contar.
 *
 * `load` tiene que ser estable —envuelto en `useCallback`— porque es lo que
 * decide cuándo se vuelve a pedir.
 */
export function useAsyncData<T>(
  load: (query: GitQuery) => Promise<T>,
  { resourceKey, isEqual }: AsyncDataOptions<T> = {},
): AsyncData<T> & { reload: (options?: ReloadOptions) => void } {
  const [state, setState] = useState<AsyncData<T>>({ status: 'loading' });
  const [pending, setPending] = useState(() => ({ load, resourceKey }));
  const [attempt, setAttempt] = useState(0);

  /*
   * Volver a «cargando» se hace durante el render y no dentro del efecto: si se
   * hiciera ahí, el cuadro que ya se pintó enseñaría por un instante los datos
   * del repositorio anterior. Es el ajuste de estado por cambio de props que
   * React documenta, y por eso `load` tiene que ser estable.
   */
  if (pending.load !== load || pending.resourceKey !== resourceKey) {
    setPending({ load, resourceKey });
    if (resourceKey === undefined || pending.resourceKey !== resourceKey) {
      setState({ status: 'loading' });
    }
  }

  useEffect(() => {
    const controller = new AbortController();

    load({ signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) {
          setState((current) =>
            current.status === 'ready' && isEqual?.(current.data, data)
              ? current
              : { status: 'ready', data },
          );
        }
      },
      (error: unknown) => {
        if (controller.signal.aborted || isCancelled(error)) return;

        setState({ status: 'failed', error: toGitOperationError(error) });
      },
    );

    return () => {
      controller.abort();
    };
  }, [load, attempt, resourceKey, isEqual]);

  const reload = useCallback((options?: ReloadOptions) => {
    setState((current) =>
      options?.retain === true && current.status === 'ready' ? current : { status: 'loading' },
    );
    setAttempt((previous) => previous + 1);
  }, []);

  return { ...state, reload };
}
