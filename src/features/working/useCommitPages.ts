import { useCallback, useEffect, useRef, useState } from 'react';

import { usePorts } from '@app/PortsContext';
import type { Commit } from '@core/domain/commit';
import { isCancelled, toGitOperationError, type GitOperationError } from '@core/domain/errors';
import type { RepoId } from '@core/domain/repository';

/** Tamaño de cada bloque incremental del historial. */
const PAGE_SIZE = 500;

export type CommitPagesState =
  | { status: 'loading' }
  | { status: 'failed'; error: GitOperationError }
  | { status: 'ready'; commits: readonly Commit[]; hasMore: boolean; loadingMore: boolean };

export interface CommitPages {
  state: CommitPagesState;
  /** Vuelve a pedir la primera página desde cero — el «Reintentar» del error. */
  reload: (options?: { retain?: boolean }) => void;
  /** Pide la página siguiente. No hace nada si ya hay una en vuelo o no queda más. */
  loadMore: () => void;
}

/**
 * La paginación de `CommitTable`, aparte del componente para que se pueda leer
 * sin la mitad de JSX alrededor.
 *
 * No usa `useAsyncData`: esa función devuelve una sola página y aquí hace
 * falta acumular — la lista crece, no se reemplaza — así que lleva su propio
 * estado, con la misma regla de cancelación: cada petición en vuelo se aborta
 * si el repositorio cambia o el componente se desmonta.
 */
export function useCommitPages(repoId: RepoId | null): CommitPages {
  const { git } = usePorts();
  const [state, setState] = useState<CommitPagesState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Sincrónico y no en estado: dos disparos de `loadMore` en el mismo cuadro
  // — dos eventos de scroll seguidos, por ejemplo — no deben pedir la misma
  // página dos veces mientras React todavía no repintó `loadingMore`.
  const loadingMoreRef = useRef(false);
  const moreControllers = useRef<Set<AbortController>>(new Set());

  // Volver a «cargando» se hace durante el render y no dentro del efecto —
  // mismo ajuste que `useAsyncData`: hacerlo en el efecto dejaría un cuadro
  // enseñando los commits del repositorio anterior antes de limpiarlos.
  const [pendingRepoId, setPendingRepoId] = useState(repoId);

  if (pendingRepoId !== repoId) {
    setPendingRepoId(repoId);
    setState({ status: 'loading' });
    // `loadingMoreRef` no hace falta tocarlo aquí: con el estado ya en
    // `loading`, la comprobación de `loadMore` lo deja sin efecto igual, y
    // mutar un ref durante el render está prohibido.
  }

  useEffect(() => {
    if (!repoId) return;
    const controller = new AbortController();
    const pendingPages = moreControllers.current;

    git.readCommits(repoId, { limit: PAGE_SIZE }, { signal: controller.signal }).then(
      (page) => {
        if (controller.signal.aborted) return;

        setState({
          status: 'ready',
          commits: page.commits,
          hasMore: page.hasMore,
          loadingMore: false,
        });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isCancelled(error)) return;

        setState({ status: 'failed', error: toGitOperationError(error) });
      },
    );

    return () => {
      controller.abort();
      for (const pending of pendingPages) pending.abort();
      pendingPages.clear();
      loadingMoreRef.current = false;
    };
  }, [git, repoId, attempt]);

  const loadMore = useCallback(() => {
    if (!repoId || state.status !== 'ready' || !state.hasMore || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setState({ ...state, loadingMore: true });

    const controller = new AbortController();

    moreControllers.current.add(controller);

    git
      .readCommits(
        repoId,
        { skip: state.commits.length, limit: PAGE_SIZE },
        { signal: controller.signal },
      )
      .then(
        (page) => {
          moreControllers.current.delete(controller);
          if (controller.signal.aborted) return;

          loadingMoreRef.current = false;

          setState((latest) =>
            latest.status === 'ready'
              ? {
                  status: 'ready',
                  commits: [...latest.commits, ...page.commits],
                  hasMore: page.hasMore,
                  loadingMore: false,
                }
              : latest,
          );
        },
        (error: unknown) => {
          moreControllers.current.delete(controller);
          if (controller.signal.aborted) return;

          loadingMoreRef.current = false;
          if (isCancelled(error)) return;

          // Sin panel de error aquí: la tabla ya enseña lo que sí llegó, y un
          // error tapándolo se llevaría filas que se leyeron bien. Acercarse
          // otra vez al final reintenta sola.
          setState((latest) =>
            latest.status === 'ready' ? { ...latest, loadingMore: false } : latest,
          );
        },
      );
  }, [state, git, repoId]);

  const reload = useCallback((options?: { retain?: boolean }) => {
    setState((current) =>
      options?.retain === true && current.status === 'ready' ? current : { status: 'loading' },
    );
    loadingMoreRef.current = false;
    setAttempt((value) => value + 1);
  }, []);

  return { state, reload, loadMore };
}
