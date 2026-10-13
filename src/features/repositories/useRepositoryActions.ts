import { useMemo } from 'react';

import { usePorts } from '@app/PortsContext';
import { useShellStore } from '@app/shellStore';
import type { WorkingBase } from '@app/tabs';
import { isCancelled, toGitOperationError, type GitErrorParams } from '@core/domain/errors';
import {
  DEFAULT_LIBRARY,
  type Library,
  type LibraryLayout,
  type LibraryView,
  type RepoAvatar,
  type RepoSort,
  type Space,
  type SpaceId,
} from '@core/domain/library';
import type { Repository, RepoId, RepoSummary } from '@core/domain/repository';
import type { CloneRequest, GitQuery } from '@core/ports/GitPort';

import { ALL_ORIGIN, useRepositoriesStore, type RepositoryBatchFailure } from './repositoriesStore';

export interface RepositoryActions {
  load: (signal?: AbortSignal) => Promise<void>;
  openFolder: () => void;
  open: (repo: RepoSummary, onOpened?: () => void) => void;
  openMany: (repos: readonly RepoSummary[]) => void;
  openAll: (space: Space, repos: readonly RepoSummary[]) => void;
  reveal: (repo: RepoSummary) => void;
  locate: (repo: RepoSummary) => void;
  forget: (repo: RepoSummary, next: RepoSummary | null) => void;
  forgetMany: (repos: readonly RepoSummary[]) => void;
  setSort: (sort: RepoSort) => void;
  setLayout: (layout: LibraryLayout) => void;
  setView: (view: LibraryView) => void;
  openSpace: (id: SpaceId) => void;
  createSpace: (name: string) => void;
  createSpaceAndAdd: (name: string, repo: RepoSummary) => void;
  createSpaceAndAddMany: (name: string, repos: readonly RepoSummary[]) => void;
  renameSpace: (space: Space, name: string) => void;
  deleteSpace: (space: Space) => void;
  moveSpace: (space: Space, toIndex: number) => void;
  addToSpace: (space: Space, repo: RepoSummary) => void;
  addManyToSpace: (target: Space, repos: readonly RepoSummary[], reveal?: boolean) => void;
  removeFromSpace: (space: Space, repo: RepoSummary) => void;
  removeManyFromSpace: (
    space: Space,
    repos: readonly RepoSummary[],
    onRemoved?: () => void,
  ) => void;
  moveRepoToSpace: (
    target: Space,
    repo: RepoSummary,
    from: SpaceId | null,
    reveal?: boolean,
  ) => void;
  setSpaceCollapsed: (id: SpaceId, collapsed: boolean) => void;
  cycleSort: () => void;
  setAvatar: (repo: RepoSummary, avatar: RepoAvatar | null) => void;
  pickFolder: () => Promise<string | null>;
  resolveChildPath: (parent: string, child: string) => Promise<string>;
  createRepository: (
    path: string,
    options: { name: string; initialBranch: string },
  ) => Promise<Repository>;
  cloneRepository: (request: CloneRequest, query?: GitQuery) => Promise<Repository>;
  selectByPath: (path: string) => void;
}

export function baseFor(repository: RepoSummary): Omit<WorkingBase, 'kind'> {
  return {
    repoId: repository.id,
    repoName: repository.name,
    repoPath: repository.path,
    branch: repository.head,
    ...(repository.worktreeOf === undefined ? {} : { worktreeOf: repository.worktreeOf }),
  };
}

export function useRepositoryActions(): RepositoryActions {
  const { git, system, library: libraryPort } = usePorts();

  return useMemo<RepositoryActions>(() => {
    const store = () => useRepositoriesStore.getState();
    const shell = () => useShellStore.getState();

    const load = async (signal?: AbortSignal) => {
      store().beginLoad();
      try {
        const [repositories, library] = await Promise.all([
          git.listRepositories({ signal }),
          libraryPort.read(),
        ]);
        if (!signal?.aborted) store().loaded(repositories, library);
      } catch (error) {
        if (!signal?.aborted && !isCancelled(error)) store().failList(toGitOperationError(error));
      }
    };
    const reload = () => load();

    const activateRepository = async (repo: RepoSummary) => {
      await git.markOpened(repo.id);
      store().setLibrary(await libraryPort.recordOpening(repo.id));
      shell().openWorking(baseFor(repo));
    };

    const openRepository = async (repo: RepoSummary, showError: boolean): Promise<boolean> => {
      try {
        await activateRepository(repo);
        if (showError) store().setOpenError(null);
        return true;
      } catch (error) {
        if (isCancelled(error)) return false;
        if (showError) {
          store().select(repo);
          store().setOpenError(toGitOperationError(error));
        }
        return false;
      }
    };

    const runBatch = (
      repos: readonly RepoSummary[],
      operation: 'open' | 'forget',
      space?: Space,
    ) => {
      if (store().batchBusy) return;
      const unique = [...new Map(repos.map((repo) => [repo.id, repo])).values()];
      if (unique.length === 0) return;

      store().setBatchBusy(true);
      store().setBatchFailures([]);
      store().setOpenError(null);
      if (operation === 'forget') store().closeDialog();

      void (async () => {
        const failures: RepositoryBatchFailure[] = [];
        const succeeded = new Set<string>();
        let cancelled = 0;
        try {
          // Library persistence and tab activation follow the same stable order.
          for (const repo of unique) {
            try {
              if (operation === 'open') await activateRepository(repo);
              else await git.forgetRepository(repo.id);
              succeeded.add(repo.id);
            } catch (error) {
              if (isCancelled(error)) cancelled += 1;
              else failures.push({ repo, error: toGitOperationError(error), operation });
            }
          }
          store().setBatchFailures(failures);
          if (operation === 'forget') {
            store().selectMany(
              new Set([...store().selectedIds].filter((id) => !succeeded.has(id))),
              store().selectedFrom,
            );
          }
          const partial = failures.length > 0 || cancelled > 0;
          shell().setStatus({
            tone: partial ? 'warning' : 'success',
            key: space
              ? partial
                ? 'repositories.status.openedSpaceWithFailures'
                : 'repositories.status.openedSpace'
              : operation === 'open'
                ? partial
                  ? 'repositories.status.openedManyWithFailures'
                  : 'repositories.status.openedMany'
                : partial
                  ? 'repositories.status.forgottenManyWithFailures'
                  : 'repositories.status.forgottenMany',
            params: {
              count: succeeded.size,
              failed: failures.length,
              cancelled,
              ...(space ? { space: space.name } : {}),
            },
          });
        } finally {
          try {
            await reload();
          } finally {
            store().setBatchBusy(false);
          }
        }
      })();
    };

    const runSpaceBatch = (
      repos: readonly RepoSummary[],
      spaceName: string,
      reveal: boolean,
      creating: boolean,
      persist: (ids: readonly RepoId[]) => Promise<{ library: Library; space: Space }>,
    ) => {
      if (store().batchBusy) return;
      const ids = [...new Set(repos.map((repo) => repo.id))];
      if (ids.length === 0) return;
      const origin = store().selectedFrom;
      store().setBatchBusy(true);
      store().setBatchFailures([]);
      store().setOpenError(null);

      void (async () => {
        try {
          const { library, space } = await persist(ids);
          const members = new Set(space.repos);
          if (!ids.every((id) => members.has(id))) {
            throw new Error(`The repository selection was not added to space "${space.name}"`);
          }
          store().setLibrary(library);
          store().selectMany(new Set(ids), reveal ? `space:${space.id}` : origin);
          if (creating) store().closeDialog();
          shell().setStatus({
            tone: 'success',
            key: 'repositories.status.addedManyToSpace',
            params: { count: ids.length, space: space.name },
          });
        } catch (error) {
          if (!isCancelled(error)) store().setOpenError(toGitOperationError(error), 'space');
          shell().setStatus({
            tone: isCancelled(error) ? 'info' : 'warning',
            key: isCancelled(error)
              ? 'repositories.status.addManyToSpaceCancelled'
              : 'repositories.status.addManyToSpaceFailed',
            params: { count: ids.length, space: spaceName },
          });
        } finally {
          store().setBatchBusy(false);
        }
      })();
    };

    const removeSelectionFromSpace = (
      target: Space,
      repos: readonly RepoSummary[],
      single?: RepoSummary,
      onRemoved?: () => void,
    ) => {
      if (store().batchBusy) return;
      const ids = [...new Set(repos.map((repo) => repo.id))];
      if (ids.length === 0) return;
      store().setBatchBusy(true);
      store().setBatchFailures([]);
      store().setOpenError(null);

      void (async () => {
        try {
          const previous = await libraryPort.read();
          const before = previous.spaces.find((space) => space.id === target.id);
          if (!before) {
            throw new Error(`The space "${target.name}" no longer exists`);
          }
          const membersBefore = new Set(before.repos);
          const affected = ids.filter((id) => membersBefore.has(id));
          const library = await libraryPort.removeManyFromSpaces(ids, [target.id]);
          const after = library.spaces.find((space) => space.id === target.id);
          if (!after) {
            throw new Error(`The space "${target.name}" no longer exists`);
          }
          const membersAfter = new Set(after.repos);
          if (ids.some((id) => membersAfter.has(id))) {
            throw new Error('The repository selection could not be removed from the space');
          }
          store().setLibrary(library);
          const origin = store().selectedFrom;
          if (affected.length > 0 && origin === `space:${target.id}`) {
            store().selectMany(store().selectedIds, ALL_ORIGIN);
          }
          shell().setStatus({
            tone: affected.length === 0 ? 'info' : 'success',
            key:
              single && affected.length === 1
                ? 'repositories.status.removedFromSpace'
                : 'repositories.status.removedManyFromSpace',
            params:
              single && affected.length === 1
                ? { repo: single.name, space: before.name }
                : { count: affected.length, space: before.name },
          });
          if (affected.length > 0) onRemoved?.();
        } catch (error) {
          if (!isCancelled(error)) store().setOpenError(toGitOperationError(error), 'space');
          shell().setStatus({
            tone: isCancelled(error) ? 'info' : 'warning',
            key: isCancelled(error)
              ? 'repositories.status.removeManyFromSpaceCancelled'
              : 'repositories.status.removeManyFromSpaceFailed',
            params: { count: ids.length, space: target.name },
          });
        } finally {
          store().setBatchBusy(false);
        }
      })();
    };

    return {
      load,
      openFolder: () => {
        void (async () => {
          try {
            const path = await system.pickDirectory();
            if (path === null) return;
            const repository = await git.openRepository(path);
            await reload();
            store().select(repository);
            shell().setStatus({
              tone: 'success',
              key: 'repositories.status.added',
              params: { repo: repository.name, path: repository.path },
            });
          } catch (error) {
            if (isCancelled(error)) return;
            const failure = toGitOperationError(error);
            if (failure.code === 'repo.alreadyExists') {
              const params = failure.params as GitErrorParams['repo.alreadyExists'];
              const known = store().repositories?.find((repo) => repo.path === params.path);
              if (known) store().select(known);
              shell().setStatus({
                tone: 'info',
                key: 'repositories.status.alreadyKnown',
                params: { repo: params.repo, path: params.path },
              });
              return;
            }
            store().setFolderError(failure);
          }
        })();
      },
      open: (repo, onOpened) => {
        if (store().batchBusy) return;
        void (async () => {
          if (await openRepository(repo, true)) onOpened?.();
          void reload();
        })();
      },
      openMany: (repos) => runBatch(repos, 'open'),
      openAll: (space, repos) => runBatch(repos, 'open', space),
      reveal: (repo) => {
        void system.revealPath(repo.path).catch(() => {
          shell().setStatus({
            tone: 'warning',
            key: 'repositories.status.revealFailed',
            params: { path: repo.path },
          });
        });
      },
      locate: (repo) => {
        void (async () => {
          try {
            const path = await system.pickDirectory();
            if (path === null) return;
            const found = await git.openRepository(path);
            await git.forgetRepository(repo.id);
            await reload();
            store().setOpenError(null);
            store().select(found);
            shell().setStatus({
              tone: 'success',
              key: 'repositories.status.located',
              params: { repo: found.name, path: found.path },
            });
          } catch (error) {
            if (!isCancelled(error)) store().setOpenError(toGitOperationError(error));
          }
        })();
      },
      forget: (repo, next) => {
        if (store().batchBusy) return;
        void (async () => {
          try {
            await git.forgetRepository(repo.id);
            store().select(next);
            await reload();
            shell().setStatus({
              tone: 'success',
              key: 'repositories.status.forgotten',
              params: { repo: repo.name, path: repo.path },
            });
          } catch (error) {
            if (!isCancelled(error)) store().setOpenError(toGitOperationError(error));
          }
        })();
      },
      forgetMany: (repos) => runBatch(repos, 'forget'),
      setSort: (sort) => {
        void libraryPort.setSort(sort).then(store().setLibrary);
      },
      setLayout: (layout) => {
        void libraryPort.setLayout(layout).then(store().setLibrary);
      },
      setView: (view) => {
        void libraryPort.setView(view).then(store().setLibrary);
      },
      openSpace: (id) => {
        void (async () => {
          try {
            await libraryPort.setLayout('spaces');
            await libraryPort.setSpaceCollapsed(id, false);
            store().setLibrary(await libraryPort.setView({ kind: 'space', id }));
            shell().goToRepositories();
          } catch (error) {
            if (!isCancelled(error)) {
              store().setOpenError(toGitOperationError(error));
              shell().goToRepositories();
            }
          }
        })();
      },
      createSpace: (name) => {
        void (async () => {
          const previous = new Set(store().library?.spaces.map((space) => space.id) ?? []);
          const library = await libraryPort.createSpace(name.trim());
          const created = library.spaces.find((space) => !previous.has(space.id));
          store().setLibrary(library);
          store().closeDialog();
          if (created) {
            store().setLibrary(await libraryPort.setView({ kind: 'space', id: created.id }));
            shell().setStatus({
              tone: 'success',
              key: 'repositories.status.spaceCreated',
              params: { space: created.name },
            });
          }
        })();
      },
      createSpaceAndAdd: (name, repo) => {
        void (async () => {
          const previous = new Set(store().library?.spaces.map((space) => space.id) ?? []);
          const createdLibrary = await libraryPort.createSpace(name.trim());
          const created = createdLibrary.spaces.find((space) => !previous.has(space.id));
          store().closeDialog();
          if (!created) {
            store().setLibrary(createdLibrary);
            return;
          }

          await libraryPort.addToSpace(created.id, repo.id);
          await libraryPort.setLayout('spaces');
          const library = await libraryPort.setView({ kind: 'space', id: created.id });
          store().setLibrary(library);
          store().select(repo, `space:${created.id}`);
          shell().setStatus({
            tone: 'success',
            key: 'repositories.status.addedToSpace',
            params: { repo: repo.name, space: created.name },
          });
        })();
      },
      createSpaceAndAddMany: (name, repos) => {
        const clean = name.trim();
        runSpaceBatch(repos, clean, true, true, async (ids) => {
          const previous = await libraryPort.read();
          if (clean === '') throw new Error('The space name cannot be empty');
          if (previous.spaces.some((space) => space.name === clean)) {
            throw new Error(`A space named "${clean}" already exists`);
          }
          const previousIds = new Set(previous.spaces.map((space) => space.id));
          const library = await libraryPort.createSpaceAndAddMany(clean, ids);
          const space = library.spaces.find(
            (candidate) => candidate.name === clean && !previousIds.has(candidate.id),
          );
          if (!space) throw new Error(`The space "${clean}" could not be created`);
          return { library, space };
        });
      },
      renameSpace: (space, name) => {
        const clean = name.trim();
        store().setRenaming(null);
        if (clean === space.name) return;
        void libraryPort.renameSpace(space.id, clean).then((library) => {
          store().setLibrary(library);
          shell().setStatus({
            tone: 'success',
            key: 'repositories.status.spaceRenamed',
            params: { from: space.name, to: clean },
          });
        });
      },
      deleteSpace: (space) => {
        store().closeDialog();
        void libraryPort.deleteSpace(space.id).then((library) => {
          store().setLibrary(library);
          shell().setStatus({
            tone: 'success',
            key: 'repositories.status.spaceDeleted',
            params: { space: space.name },
          });
        });
      },
      moveSpace: (space, toIndex) => {
        void libraryPort.moveSpace(space.id, toIndex).then(store().setLibrary);
      },
      addToSpace: (space, repo) => {
        void libraryPort.addToSpace(space.id, repo.id).then((library) => {
          store().setLibrary(library);
          shell().setStatus({
            tone: 'success',
            key: 'repositories.status.addedToSpace',
            params: { repo: repo.name, space: space.name },
          });
        });
      },
      addManyToSpace: (target, repos, reveal = false) => {
        runSpaceBatch(repos, target.name, reveal, false, async (ids) => {
          const library = await libraryPort.addManyToSpace(target.id, ids, reveal);
          const space = library.spaces.find((candidate) => candidate.id === target.id);
          if (!space) throw new Error(`The space "${target.name}" no longer exists`);
          return { library, space };
        });
      },
      removeFromSpace: (space, repo) => removeSelectionFromSpace(space, [repo], repo),
      removeManyFromSpace: (space, repos, onRemoved) =>
        removeSelectionFromSpace(space, repos, undefined, onRemoved),
      moveRepoToSpace: (target, repo, from, reveal = false) => {
        if (target.id === from) return;
        void (async () => {
          const origin =
            from === null ? undefined : store().library?.spaces.find((space) => space.id === from);
          if (from !== null) await libraryPort.removeFromSpace(from, repo.id);
          const added = await libraryPort.addToSpace(target.id, repo.id);
          if (reveal) await libraryPort.setLayout('spaces');
          const library = reveal
            ? await libraryPort.setView({ kind: 'space', id: target.id })
            : added;
          store().setLibrary(library);
          store().select(repo, `space:${target.id}`);
          shell().setStatus(
            origin
              ? {
                  tone: 'success',
                  key: 'repositories.status.movedToSpace',
                  params: { repo: repo.name, from: origin.name, to: target.name },
                }
              : {
                  tone: 'success',
                  key: 'repositories.status.addedToSpace',
                  params: { repo: repo.name, space: target.name },
                },
          );
        })();
      },
      setSpaceCollapsed: (id, collapsed) => {
        void libraryPort.setSpaceCollapsed(id, collapsed).then(store().setLibrary);
      },
      cycleSort: () => {
        const current = store().library?.sort ?? DEFAULT_LIBRARY.sort;
        void libraryPort
          .setSort(current === 'name' ? 'lastOpened' : 'name')
          .then(store().setLibrary);
      },
      setAvatar: (repo, avatar) => {
        store().closeDialog();
        void libraryPort.setAvatar(repo.id, avatar).then((library) => {
          store().setLibrary(library);
          shell().setStatus({
            tone: 'success',
            key:
              avatar === null
                ? 'repositories.status.avatarCleared'
                : 'repositories.status.avatarChanged',
            params: { repo: repo.name },
          });
        });
      },
      pickFolder: () => system.pickDirectory(),
      resolveChildPath: (parent, child) => system.resolveChildPath(parent, child),
      createRepository: async (path, options) => {
        const repository = await git.createRepository(path, options);
        await reload();
        store().select(repository);
        store().closeDialog();
        shell().setStatus({
          tone: 'success',
          key: 'repositories.status.created',
          params: { repo: repository.name, path: repository.path },
        });
        return repository;
      },
      cloneRepository: async (request, query) => {
        const repository = await git.cloneRepository(request, query);
        await reload();
        store().select(repository);
        store().closeDialog();
        shell().setStatus({
          tone: 'success',
          key: 'repositories.status.cloned',
          params: { repo: repository.name, path: repository.path },
        });
        return repository;
      },
      selectByPath: (path) => {
        const known = store().repositories?.find((repo) => repo.path === path);
        if (known) {
          store().select(known);
          store().closeDialog();
        }
      },
    };
  }, [git, libraryPort, system]);
}
