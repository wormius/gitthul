import { useMemo } from 'react';

import type { GestureDefinition } from '@app/gestures';
import { useShellStore } from '@app/shellStore';
import { activeTab } from '@app/tabs';
import { useI18n } from '@i18n/useI18n';

import { useResolveStore } from './resolveStore';

/**
 * Los gestos de Resolver, para que `GestureProvider` los concatene con los del
 * shell, los de Repositorios y los de GitWorking.
 *
 * **Solo entran los que ya tienen un `run()` de verdad**, que es el criterio que
 * F2.2 fijó y que F0.15 heredó: un gesto sin ejecución no es un gesto. Los del
 * resolutor de tres paneles —tomar un bloque, ir al siguiente— llegan con F3.2,
 * que es cuando hay bloques que tomar.
 *
 * Como los de GitWorking, actúan sobre lo que el store sabe: `run()` no lleva
 * parámetros, así que sobre qué archivos operan lo dice la selección de las
 * listas. Fuera de Resolver están deshabilitados y fuera de la búsqueda: sin
 * conflictos, esta vista no existe.
 */
export function useResolveGestureDefinitions(): readonly GestureDefinition[] {
  const { t } = useI18n();
  const tab = useShellStore(activeTab);
  const settingsOpen = useShellStore((state) => state.settingsOpen);
  const selected = useResolveStore((state) => state.selected);
  const step = useResolveStore((state) => state.step);
  const blockIds = useResolveStore((state) => state.blockIds);
  const blockIndex = useResolveStore((state) => state.blockIndex);
  const take = useResolveStore((state) => state.take);
  const backToResolver = useResolveStore((state) => state.backToResolver);
  const requestMarkResolved = useResolveStore((state) => state.requestMarkResolved);
  const nextBlock = useResolveStore((state) => state.nextBlock);
  const previousBlock = useResolveStore((state) => state.previousBlock);
  const requestUnresolve = useResolveStore((state) => state.requestUnresolve);
  const requestRevert = useResolveStore((state) => state.requestRevert);
  const requestAuto = useResolveStore((state) => state.requestAuto);
  const requestKeepStaged = useResolveStore((state) => state.requestKeepStaged);
  const conflictedCount = useResolveStore((state) => state.conflictedCount);
  const resolvedCount = useResolveStore((state) => state.resolvedCount);

  return useMemo<readonly GestureDefinition[]>(() => {
    const viewingWorking = tab?.surface.kind === 'working';
    const away = !viewingWorking || settingsOpen || conflictedCount + resolvedCount === 0;
    const paths = [...selected];
    const count = paths.length;

    /*
     * Los seis del resolutor solo existen mientras hay un archivo abierto: sin
     * bloques que tomar, un gesto de tomar bloques no es un gesto.
     */
    const resolving = !away && step === 'resolver';
    const noBlock = !resolving || blockIds.length === 0;

    return [
      {
        id: 'resolve.takeOurs',
        label: t('gesture.resolve.takeOurs'),
        triggers: ['button', 'search'],
        disabled: noBlock,
        hiddenInSearch: !resolving,
        run: () => {
          take('ours');
        },
      },
      {
        id: 'resolve.takeTheirs',
        label: t('gesture.resolve.takeTheirs'),
        triggers: ['button', 'search'],
        disabled: noBlock,
        hiddenInSearch: !resolving,
        run: () => {
          take('theirs');
        },
      },
      {
        id: 'resolve.takeNeither',
        label: t('gesture.resolve.takeNeither'),
        triggers: ['button', 'search'],
        disabled: noBlock,
        hiddenInSearch: !resolving,
        run: () => {
          take('none');
        },
      },
      {
        id: 'resolve.nextBlock',
        label: t('gesture.resolve.nextBlock'),
        triggers: ['shortcut', 'search'],
        shortcut: 'Alt+N',
        disabled: noBlock || blockIndex >= blockIds.length - 1,
        hiddenInSearch: !resolving,
        run: nextBlock,
      },
      {
        id: 'resolve.previousBlock',
        label: t('gesture.resolve.previousBlock'),
        triggers: ['shortcut', 'search'],
        shortcut: 'Alt+P',
        disabled: noBlock || blockIndex === 0,
        hiddenInSearch: !resolving,
        run: previousBlock,
      },
      {
        /*
         * Los dos de la comprobación no llevan atajo, y es la invariante 3 tal
         * como quedó: un camino basta cuando el segundo sería inventado. La
         * pantalla tiene dos botones y nada más; un `Mod+algo` para pulsar uno
         * de dos botones que están a la vista no lo recordaría nadie.
         */
        id: 'resolve.markResolved',
        label: t('gesture.resolve.markResolved'),
        triggers: ['button', 'search'],
        disabled: away || step !== 'review',
        hiddenInSearch: step !== 'review',
        run: requestMarkResolved,
      },
      {
        id: 'resolve.back',
        label: t('gesture.resolve.back'),
        triggers: ['button', 'search'],
        disabled: away || step !== 'review',
        hiddenInSearch: step !== 'review',
        run: backToResolver,
      },
      {
        id: 'resolve.unresolve',
        label:
          count > 0
            ? t('gesture.resolve.unresolve', { count })
            : t('gesture.resolve.unresolveNone'),
        triggers: ['button', 'menu', 'search'],
        disabled: away || count === 0,
        hiddenInSearch: away,
        run: () => {
          if (count > 0) requestUnresolve(paths);
        },
      },
      {
        id: 'resolve.revertToResolved',
        label: count > 0 ? t('gesture.resolve.revert', { count }) : t('gesture.resolve.revertNone'),
        triggers: ['menu', 'search'],
        disabled: away || count === 0,
        hiddenInSearch: away,
        run: () => {
          if (count > 0) requestRevert(paths);
        },
      },
      {
        id: 'resolve.auto',
        label: t('gesture.resolve.auto'),
        triggers: ['menu', 'search'],
        disabled: away || conflictedCount === 0,
        hiddenInSearch: away,
        run: requestAuto,
      },
      {
        /*
         * Salir dejando las resoluciones preparadas y la operación sin concluir
         * — CU-12. No es abortar ni aplicar: es revisar el resultado con calma
         * antes de cerrar, y por eso pide que no quede nada en conflicto.
         */
        id: 'resolve.keepStaged',
        label: t('gesture.resolve.keepStaged'),
        triggers: ['button', 'menu', 'search'],
        disabled: away || conflictedCount > 0,
        hiddenInSearch: away,
        run: requestKeepStaged,
      },
    ];
  }, [
    backToResolver,
    blockIds,
    blockIndex,
    conflictedCount,
    nextBlock,
    previousBlock,
    requestMarkResolved,
    step,
    take,
    requestAuto,
    requestKeepStaged,
    requestRevert,
    requestUnresolve,
    resolvedCount,
    selected,
    settingsOpen,
    t,
    tab,
  ]);
}
