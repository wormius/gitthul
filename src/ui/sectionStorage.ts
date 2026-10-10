import { createContext, useCallback, useContext, useState } from 'react';

/**
 * Dónde sobreviven los plegados con nombre — el acordeón de una sección, un
 * panel que se recuerda abierto o cerrado.
 *
 * Es el mismo reparto que `paneStorage.ts`: el primitivo habla contra esta
 * interfaz mínima y nunca contra un puerto, así que no tiene por qué saber que
 * existe un archivo de ajustes ni que su escritura es asíncrona. Quien la
 * implemente tiene que tragarse sus propios fallos — quedarse sin recordar un
 * plegado nunca justifica romper la vista.
 */
export interface SectionCollapseStore {
  /** `null` cuando no hay nada guardado todavía. */
  read: (id: string) => boolean | null;
  write: (id: string, value: boolean) => void;
}

/** Deja el plegado solo en memoria: es lo que quieren la galería y las pruebas. */
export const memorySectionCollapseStore: SectionCollapseStore = {
  read: () => null,
  write: () => undefined,
};

export const SectionStorageContext = createContext<SectionCollapseStore>(
  memorySectionCollapseStore,
);

export function useSectionStorage(): SectionCollapseStore {
  return useContext(SectionStorageContext);
}

/**
 * Booleano persistido bajo `id`, o solo en memoria si no lo hay.
 *
 * Se lee una única vez, al montar — releer en cada render dejaría el acordeón a
 * merced de lo que otra pestaña escriba a mitad de un clic —, igual que
 * `usePersistentSize`.
 */
export function usePersistentCollapse(
  id: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const store = useSectionStorage();

  const [value, setValue] = useState(() => store.read(id) ?? fallback);

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      store.write(id, next);
    },
    [id, store],
  );

  return [value, update];
}
