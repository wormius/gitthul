import { create } from 'zustand';

import type { GitOperationError } from '@core/domain/errors';
import type { Library, Space, SpaceId } from '@core/domain/library';
import type { RepoId, RepoSummary } from '@core/domain/repository';

import { filterRepositories } from './collection';

export type RepositoriesDialog =
  | { kind: 'none' }
  | { kind: 'forget'; repo: RepoSummary }
  | { kind: 'forgetMany'; repos: readonly RepoSummary[] }
  | { kind: 'create'; parentPath?: string }
  | { kind: 'clone' }
  | { kind: 'avatar'; repo: RepoSummary }
  | { kind: 'createSpace'; repo?: RepoSummary }
  | { kind: 'deleteSpace'; space: Space };

export type SelectionOrigin = 'recent' | 'all' | `space:${SpaceId}`;
export type RepositoriesDrag =
  { kind: 'space'; space: SpaceId } | { kind: 'repo'; repo: RepoSummary; from: SpaceId | null };
export const RECENT_ORIGIN: SelectionOrigin = 'recent';
export const ALL_ORIGIN: SelectionOrigin = 'all';
export const spaceOrigin = (id: SpaceId): SelectionOrigin => `space:${id}`;

export interface RepositoryBatchFailure {
  repo: RepoSummary;
  operation: 'open' | 'forget';
  error: GitOperationError;
}

export interface RepositoriesState {
  repositories: readonly RepoSummary[] | null;
  library: Library | null;
  readAt: number;
  listError: GitOperationError | null;
  folderError: GitOperationError | null;
  openError: GitOperationError | null;
  selected: RepoSummary | null;
  selectedIds: ReadonlySet<RepoId>;
  selectedFrom: SelectionOrigin;
  batchBusy: boolean;
  batchFailures: readonly RepositoryBatchFailure[];
  filter: string;
  dialog: RepositoriesDialog;
  renaming: SpaceId | null;
  dragging: RepositoriesDrag | null;
  dragOver: SpaceId | null;
}

export interface RepositoriesActions {
  beginLoad: () => void;
  loaded: (repositories: readonly RepoSummary[], library: Library) => void;
  failList: (error: GitOperationError) => void;
  setLibrary: (library: Library) => void;
  select: (repo: RepoSummary | null, from?: SelectionOrigin) => void;
  selectMany: (ids: ReadonlySet<RepoId>, from?: SelectionOrigin) => void;
  setBatchBusy: (busy: boolean) => void;
  setBatchFailures: (failures: readonly RepositoryBatchFailure[]) => void;
  setFilter: (filter: string) => void;
  setFolderError: (error: GitOperationError | null) => void;
  setOpenError: (error: GitOperationError | null) => void;
  openDialog: (dialog: RepositoriesDialog) => void;
  closeDialog: () => void;
  setRenaming: (id: SpaceId | null) => void;
  setDragging: (drag: RepositoriesDrag | null) => void;
  setDragOver: (id: SpaceId | null) => void;
  reset: () => void;
}

function freshState(): RepositoriesState {
  return {
    repositories: null,
    library: null,
    readAt: 0,
    listError: null,
    folderError: null,
    openError: null,
    selected: null,
    selectedIds: new Set(),
    selectedFrom: ALL_ORIGIN,
    batchBusy: false,
    batchFailures: [],
    filter: '',
    dialog: { kind: 'none' },
    renaming: null,
    dragging: null,
    dragOver: null,
  };
}

/** Single-repository tools only receive a target when the selection is singular. */
function reconcileSelection(repositories: readonly RepoSummary[], ids: ReadonlySet<RepoId>) {
  const byId = new Map(repositories.map((repo) => [repo.id, repo]));
  const selectedIds = new Set([...ids].filter((id) => byId.has(id)));
  const only = selectedIds.size === 1 ? selectedIds.values().next().value : undefined;
  return { selectedIds, selected: only === undefined ? null : (byId.get(only) ?? null) };
}

/** Estado de interfaz de Repositorios; los datos persistidos viven en sus puertos. */
export const useRepositoriesStore = create<RepositoriesState & RepositoriesActions>((set) => ({
  ...freshState(),
  beginLoad: () => set({ listError: null }),
  loaded: (repositories, library) =>
    set((state) => ({
      repositories,
      library,
      readAt: Date.now(),
      listError: null,
      ...reconcileSelection(filterRepositories(repositories, state.filter), state.selectedIds),
    })),
  failList: (listError) => set({ listError }),
  setLibrary: (library) => set({ library }),
  select: (selected, selectedFrom = ALL_ORIGIN) =>
    set({
      selected,
      selectedIds: new Set(selected === null ? [] : [selected.id]),
      selectedFrom,
      openError: null,
    }),
  selectMany: (ids, selectedFrom = ALL_ORIGIN) =>
    set((state) => ({
      ...reconcileSelection(filterRepositories(state.repositories ?? [], state.filter), ids),
      selectedFrom,
      openError: null,
    })),
  setBatchBusy: (batchBusy) => set({ batchBusy }),
  setBatchFailures: (batchFailures) => set({ batchFailures }),
  setFilter: (filter) =>
    set((state) => ({
      filter,
      ...reconcileSelection(
        filterRepositories(state.repositories ?? [], filter),
        state.selectedIds,
      ),
      openError: null,
    })),
  setFolderError: (folderError) => set({ folderError }),
  setOpenError: (openError) => set({ openError }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: { kind: 'none' } }),
  setRenaming: (renaming) => set({ renaming }),
  setDragging: (dragging) => set({ dragging, ...(dragging === null ? { dragOver: null } : {}) }),
  setDragOver: (dragOver) => set({ dragOver }),
  reset: () => set(freshState()),
}));
