import { createContext, useCallback, useContext, useRef, useState } from 'react';

/**
 * Dónde sobreviven los repartos de panel y los anchos de columna.
 *
 * Los primitivos hablan contra esta interfaz mínima y nunca contra un puerto:
 * `SplitPane` y `DataGrid` no tienen por qué saber que existe un archivo de
 * ajustes, y menos que su escritura es asíncrona. F0.8 aprovechó esta costura
 * para sustituir el almacenamiento local por `SettingsPort` sin tocar un solo
 * componente — el almacén que habla con el puerto vive en `src/app`, que es
 * donde se conocen los dos lados.
 *
 * Quien la implemente tiene que tragarse sus propios fallos: quedarse sin
 * recordar el ancho de una columna nunca justifica romper la vista.
 */
export interface PaneSizeStore {
  /** `null` cuando no hay nada guardado todavía. */
  read: (id: string) => number | null;
  write: (id: string, value: number) => void;
}

/** Deja el tamaño solo en memoria: es lo que quieren la galería y las pruebas. */
export const memoryPaneSizeStore: PaneSizeStore = {
  read: () => null,
  write: () => undefined,
};

export const PaneStorageContext = createContext<PaneSizeStore>(memoryPaneSizeStore);

export function usePaneStorage(): PaneSizeStore {
  return useContext(PaneStorageContext);
}

/**
 * Valor numérico persistido bajo `storageId`, o solo en memoria si no lo hay.
 *
 * Se lee una única vez, al montar: releer en cada render dejaría el componente
 * a merced de lo que otra pestaña escriba a mitad de un arrastre.
 *
 * El actualizador acepta una función y devuelve el valor resultante. Ambas
 * cosas son por lo mismo: si dos pulsaciones de flecha caen en la misma tarea,
 * React agrupa los cambios de estado y la segunda calcularía su paso desde el
 * valor de antes de la primera, perdiéndolo. Guardando aparte el último valor
 * aplicado, cada paso arranca donde terminó el anterior.
 */
export function usePersistentSize(
  storageId: string | undefined,
  fallback: number,
): [number, (next: number | ((current: number) => number)) => number] {
  const store = usePaneStorage();

  const [value, setValue] = useState(() =>
    storageId ? (store.read(storageId) ?? fallback) : fallback,
  );

  // Se lee y se escribe solo dentro del actualizador, que siempre corre desde
  // un manejador de eventos y nunca durante el render.
  const applied = useRef(value);

  const update = useCallback(
    (next: number | ((current: number) => number)) => {
      const resolved = typeof next === 'function' ? next(applied.current) : next;

      applied.current = resolved;
      setValue(resolved);

      if (storageId) store.write(storageId, resolved);

      return resolved;
    },
    [store, storageId],
  );

  return [value, update];
}
