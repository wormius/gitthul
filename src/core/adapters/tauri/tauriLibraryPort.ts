import * as domain from '@core/domain/library';
import type { Library } from '@core/domain/library';
import type { LibraryPort } from '@core/ports/LibraryPort';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

type LibraryCall = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function createTauriLibraryPort(call: LibraryCall = invoke): LibraryPort {
  let current: Library | null = null;
  let reading: Promise<Library> | null = null;
  let writes: Promise<void> = Promise.resolve();
  let lastWrite: Promise<Library> | null = null;
  const load = (): Promise<Library> => {
    if (current !== null) return Promise.resolve(current);
    reading ??= call('library_read')
      .then((saved) => (current ??= domain.normalizeLibrary(saved)))
      .finally(() => {
        reading = null;
      });
    return reading;
  };
  const mutate = (change: (library: Library) => Library): Promise<Library> => {
    const write = writes.then(async () => {
      const previous = await load();
      const next = change(previous);
      if (next === previous) return previous;
      // A failed write must leave the previous cache intact so the same drop can be retried.
      await call('library_write', { library: next });
      current = next;
      return next;
    });
    // Keep subsequent mutations usable while preserving rejection for this operation's caller.
    writes = write.then(
      () => undefined,
      () => undefined,
    );
    lastWrite = write;
    return write;
  };

  return {
    read: async () => {
      await writes;
      return load();
    },
    createSpace: (name) => mutate((library) => domain.createSpace(library, name)),
    createSpaceAndAddMany: (name, repos) =>
      mutate((library) => domain.createSpaceAndAddMany(library, name, repos)),
    renameSpace: (id, name) => mutate((library) => domain.renameSpace(library, id, name)),
    deleteSpace: (id) => mutate((library) => domain.deleteSpace(library, id)),
    moveSpace: (id, toIndex) => mutate((library) => domain.moveSpace(library, id, toIndex)),
    setSpaceCollapsed: (id, collapsed) =>
      mutate((library) => domain.setSpaceCollapsed(library, id, collapsed)),
    addToSpace: (id, repo) => mutate((library) => domain.addToSpace(library, id, repo)),
    addManyToSpace: (id, repos, reveal) =>
      mutate((library) => domain.addManyToSpace(library, id, repos, reveal)),
    removeFromSpace: (id, repo) => mutate((library) => domain.removeFromSpace(library, id, repo)),
    setView: (view) => mutate((library) => domain.setView(library, view)),
    setSort: (sort) => mutate((library) => domain.setSort(library, sort)),
    setLayout: (layout) => mutate((library) => domain.setLayout(library, layout)),
    setAvatar: (repo, avatar) => mutate((library) => domain.setAvatar(library, repo, avatar)),
    recordOpening: (_repo, at) =>
      mutate((library) => domain.recordOpening(library, at ?? Date.now())),
    flush: () => lastWrite?.then(() => undefined) ?? Promise.resolve(),
  };
}
