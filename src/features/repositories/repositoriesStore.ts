import { create } from 'zustand';

import type { GitOperationError } from '@core/domain/errors';
import type { Library, Space, SpaceId } from '@core/domain/library';
import type { RepoSummary } from '@core/domain/repository';

export type RepositoriesDialog =
  | { kind: 'none' }
  | { kind: 'forget'; repo: RepoSummary }
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

export interface RepositoriesState {
  repositories: readonly RepoSummary[] | null;
  library: Library | null;
  readAt: number;
  listError: GitOperationError | null;
  folderError: GitOperationError | null;
  openError: GitOperationError | null;
  selected: RepoSummary | null;
  selectedFrom: SelectionOrigin;
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
    selectedFrom: ALL_ORIGIN,
    filter: '',
    dialog: { kind: 'none' },
    renaming: null,
    dragging: null,
    dragOver: null,
  };
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
      selected: repositories.find((repo) => repo.id === state.selected?.id) ?? null,
    })),
  failList: (listError) => set({ listError }),
  setLibrary: (library) => set({ library }),
  select: (selected, selectedFrom = ALL_ORIGIN) => set({ selected, selectedFrom, openError: null }),
  setFilter: (filter) => set({ filter }),
  setFolderError: (folderError) => set({ folderError }),
  setOpenError: (openError) => set({ openError }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: { kind: 'none' } }),
  setRenaming: (renaming) => set({ renaming }),
  setDragging: (dragging) => set({ dragging, ...(dragging === null ? { dragOver: null } : {}) }),
  setDragOver: (dragOver) => set({ dragOver }),
  reset: () => set(freshState()),
}));
