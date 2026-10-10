import { useCallback, useRef } from 'react';

/**
 * Selección múltiple compartida por las listas y el árbol.
 *
 * Vive aparte de los dos componentes porque el comportamiento tiene que ser
 * idéntico: la lista de commits, la de archivos y el árbol de carpetas responden
 * a Ctrl y a Mayús de la misma manera, y aprender el gesto una vez debe bastar.
 */

export type SelectionMode = 'none' | 'single' | 'multiple';

const EMPTY: ReadonlySet<string> = new Set();
const EMPTY_LIST: readonly string[] = [];

/** Qué pidió el usuario, ya traducido desde las teclas modificadoras. */
export type SelectionIntent = 'replace' | 'toggle' | 'range';

interface ModifierKeys {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/** Mayús manda sobre Ctrl: pulsar las dos extiende el rango, que es lo esperado. */
export function intentFrom(event: ModifierKeys): SelectionIntent {
  if (event.shiftKey) return 'range';
  if (event.ctrlKey === true || event.metaKey === true) return 'toggle';

  return 'replace';
}

/**
 * Aplica una intención sobre la selección actual.
 *
 * `ids` va en el orden en que se ven las filas: el rango de Mayús se calcula
 * sobre lo visible, no sobre el modelo, para que filtrar o plegar una carpeta
 * no seleccione a escondidas lo que no está en pantalla.
 */
export function applySelection(
  selected: ReadonlySet<string>,
  ids: readonly string[],
  id: string,
  intent: SelectionIntent,
  anchor: string | null,
  mode: SelectionMode,
): ReadonlySet<string> {
  if (mode === 'none') return selected;
  if (mode === 'single') return new Set([id]);

  if (intent === 'toggle') {
    const next = new Set(selected);

    if (!next.delete(id)) next.add(id);

    return next;
  }

  if (intent === 'range' && anchor !== null) {
    const from = ids.indexOf(anchor);
    const to = ids.indexOf(id);

    if (from !== -1 && to !== -1) {
      const low = Math.min(from, to);
      const high = Math.max(from, to);

      return new Set(ids.slice(low, high + 1));
    }
  }

  return new Set([id]);
}

/**
 * De dónde salen los identificadores visibles, en orden.
 *
 * Llega como función y no como lista porque en una lista virtualizada la lista
 * completa puede tener cien mil entradas y solo hace falta recorrerla cuando
 * alguien extiende un rango con Mayús o pulsa Ctrl+A. Construirla en cada
 * render por si acaso costaría cien mil llamadas por pulsación de tecla.
 */
export type IdProvider = () => readonly string[];

export interface SelectionController {
  isSelected: (id: string) => boolean;
  /** Traduce un clic o una tecla en la selección resultante y la publica. */
  select: (id: string, ids: IdProvider, event: ModifierKeys) => void;
  selectAll: (ids: IdProvider) => void;
}

export function useSelection(
  mode: SelectionMode,
  selected: ReadonlySet<string> | undefined,
  onSelectedChange: ((next: ReadonlySet<string>) => void) | undefined,
): SelectionController {
  const anchorRef = useRef<string | null>(null);
  const current = selected ?? EMPTY;

  const isSelected = useCallback((id: string) => current.has(id), [current]);

  const select = useCallback(
    (id: string, ids: IdProvider, event: ModifierKeys) => {
      if (mode === 'none') return;

      const intent = intentFrom(event);
      const next = applySelection(
        current,
        intent === 'range' ? ids() : EMPTY_LIST,
        id,
        intent,
        anchorRef.current,
        mode,
      );

      // El ancla solo se mueve cuando no se está extendiendo un rango: si se
      // moviera, cada Mayús+flecha ampliaría desde la última fila y no desde
      // donde empezó la selección.
      if (intent !== 'range') anchorRef.current = id;

      onSelectedChange?.(next);
    },
    [current, mode, onSelectedChange],
  );

  const selectAll = useCallback(
    (ids: IdProvider) => {
      if (mode !== 'multiple') return;

      onSelectedChange?.(new Set(ids()));
    },
    [mode, onSelectedChange],
  );

  return { isSelected, select, selectAll };
}
