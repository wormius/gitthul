import * as library from '@core/domain/library';
import type { Library } from '@core/domain/library';
import type { LibraryPort } from '@core/ports/LibraryPort';

import { browserStorage, memoryStorage, parseJson, type JsonStorage } from './storage';

export const LIBRARY_KEY = 'gitthul.library';
export const LEGACY_LIBRARY_KEY = 'gitthul.workspace';

export function localLibraryStorage(): JsonStorage {
  const current = browserStorage(LIBRARY_KEY);
  const legacy = browserStorage(LEGACY_LIBRARY_KEY);
  return {
    read: () => current.read() ?? legacy.read(),
    write: current.write,
  };
}

export function createMockLibraryPort(
  options: { storage?: JsonStorage; now?: () => number } = {},
): LibraryPort {
  const storage = options.storage ?? memoryStorage();
  const now = options.now ?? (() => Date.now());
  let current: Library | null = null;
  const load = () => (current ??= library.normalizeLibrary(parseJson(storage.read()), now()));
  const save = (next: Library): Promise<Library> => {
    if (next !== current) {
      current = next;
      storage.write(JSON.stringify(next));
    }
    return Promise.resolve(next);
  };

  return {
    read: () => Promise.resolve(load()),
    createSpace: (name) => save(library.createSpace(load(), name)),
    renameSpace: (id, name) => save(library.renameSpace(load(), id, name)),
    deleteSpace: (id) => save(library.deleteSpace(load(), id)),
    moveSpace: (id, toIndex) => save(library.moveSpace(load(), id, toIndex)),
    setSpaceCollapsed: (id, collapsed) => save(library.setSpaceCollapsed(load(), id, collapsed)),
    addToSpace: (id, repo) => save(library.addToSpace(load(), id, repo)),
    removeFromSpace: (id, repo) => save(library.removeFromSpace(load(), id, repo)),
    setView: (view) => save(library.setView(load(), view)),
    setSort: (sort) => save(library.setSort(load(), sort)),
    setLayout: (layout) => save(library.setLayout(load(), layout)),
    setAvatar: (repo, avatar) => save(library.setAvatar(load(), repo, avatar)),
    recordOpening: (_repo, at) => save(library.recordOpening(load(), at ?? now())),
    flush: () => Promise.resolve(),
  };
}
