import { useCallback, useMemo } from 'react';

import { usePersistentCollapse } from '@ui/sectionStorage';

import type { RefSectionKey } from './contextMenus';

export interface SectionCollapse {
  collapsed: Readonly<Record<RefSectionKey, boolean>>;
  toggle: (section: RefSectionKey) => void;
  /** «Plegar todas las secciones» / «Desplegar todas» — menú de cabecera. */
  setAll: (collapsed: boolean) => void;
}

/**
 * El plegado de las cinco secciones del panel de referencias.
 *
 * Sale de `RefPanel` y sube a la vista porque hay dos consumidores: el panel,
 * que pinta cada acordeón, y el menú de cabecera, que pliega o despliega las
 * cinco de un tirón — y ese menú lo construye `useWorkingActions`, que no está
 * dentro del panel. Un `usePersistentCollapse` por sección y siempre en el
 * mismo orden: son cinco fijas, no una lista dinámica, así que no rompe la
 * regla de los hooks.
 */
export function useSectionCollapse(): SectionCollapse {
  const [locals, setLocals] = usePersistentCollapse('locals', false);
  const [remotes, setRemotes] = usePersistentCollapse('remotes', false);
  const [tags, setTags] = usePersistentCollapse('tags', false);
  const [stashes, setStashes] = usePersistentCollapse('stashes', false);
  const [worktrees, setWorktrees] = usePersistentCollapse('worktrees', false);

  const collapsed = useMemo(
    () => ({ locals, remotes, tags, stashes, worktrees }),
    [locals, remotes, stashes, tags, worktrees],
  );

  const setters = useMemo(
    () => ({
      locals: setLocals,
      remotes: setRemotes,
      tags: setTags,
      stashes: setStashes,
      worktrees: setWorktrees,
    }),
    [setLocals, setRemotes, setStashes, setTags, setWorktrees],
  );

  const toggle = useCallback(
    (section: RefSectionKey) => {
      setters[section](!collapsed[section]);
    },
    [collapsed, setters],
  );

  const setAll = useCallback(
    (next: boolean) => {
      for (const set of Object.values(setters)) set(next);
    },
    [setters],
  );

  return { collapsed, toggle, setAll };
}
