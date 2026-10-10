import { createContext, useContext } from 'react';

/**
 * Registro de los paneles cuyo scroll va atado.
 *
 * Es contexto y no props porque quien monta un diff a dos columnas o el
 * resolutor de tres paneles no debería tener que cablear referencias entre
 * hermanos: cada panel se apunta al montarse y se borra al desmontarse.
 */

export type SyncAxis = 'vertical' | 'horizontal' | 'both';

/**
 * `absolute` copia el desplazamiento en píxeles: es lo correcto cuando las
 * líneas de los paneles se corresponden una a una, como en el resolutor.
 * `proportional` copia la fracción recorrida, para paneles de alturas
 * distintas donde lo que importa es ir por el mismo punto del archivo.
 */
export type SyncMode = 'absolute' | 'proportional';

export interface SyncScrollRegistry {
  register: (pane: HTMLElement) => () => void;
  /** Propaga a los demás el scroll del panel que lo originó. */
  broadcast: (source: HTMLElement) => void;
}

export const SyncScrollContext = createContext<SyncScrollRegistry | null>(null);

export function useSyncScrollRegistry(): SyncScrollRegistry {
  const registry = useContext(SyncScrollContext);

  if (!registry) throw new Error('SyncScrollPane solo funciona dentro de un SyncScroll');

  return registry;
}

/** Cuánto habría que desplazar `target` para acompañar a `source`. */
export function mirroredOffset(
  source: { scroll: number; scrollSize: number; clientSize: number },
  target: { scrollSize: number; clientSize: number },
  mode: SyncMode,
): number {
  if (mode === 'absolute') return source.scroll;

  const sourceRange = source.scrollSize - source.clientSize;
  const targetRange = target.scrollSize - target.clientSize;

  if (sourceRange <= 0 || targetRange <= 0) return 0;

  return (source.scroll / sourceRange) * targetRange;
}
