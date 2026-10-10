import * as domain from '@core/domain/library';
import type { Library } from '@core/domain/library';
import type { LibraryPort } from '@core/ports/LibraryPort';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

export function createTauriLibraryPort(): LibraryPort {
  let current: Library | null = null;
  const load = async () =>
    (current ??= domain.normalizeLibrary(await invoke<unknown>('library_read')));
  const mutate = async (change: (library: Library) => Library): Promise<Library> => {
    const previous = await load();
    const next = change(previous);
    if (next === previous) return next;
    current = next;
    await invoke('library_write', { library: next });
    return next;
  };

  return {
    read: load,
    createSpace: (name) => mutate((library) => domain.createSpace(library, name)),
    renameSpace: (id, name) => mutate((library) => domain.renameSpace(library, id, name)),
    deleteSpace: (id) => mutate((library) => domain.deleteSpace(library, id)),
    moveSpace: (id, toIndex) => mutate((library) => domain.moveSpace(library, id, toIndex)),
    setSpaceCollapsed: (id, collapsed) =>
      mutate((library) => domain.setSpaceCollapsed(library, id, collapsed)),
    addToSpace: (id, repo) => mutate((library) => domain.addToSpace(library, id, repo)),
    removeFromSpace: (id, repo) => mutate((library) => domain.removeFromSpace(library, id, repo)),
    setView: (view) => mutate((library) => domain.setView(library, view)),
    setSort: (sort) => mutate((library) => domain.setSort(library, sort)),
    setLayout: (layout) => mutate((library) => domain.setLayout(library, layout)),
    setAvatar: (repo, avatar) => mutate((library) => domain.setAvatar(library, repo, avatar)),
    recordOpening: (_repo, at) =>
      mutate((library) => domain.recordOpening(library, at ?? Date.now())),
    flush: () => Promise.resolve(),
  };
}
