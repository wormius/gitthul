import type {
  Library,
  LibraryLayout,
  LibraryView,
  RepoAvatar,
  RepoSort,
  SpaceId,
} from '@core/domain/library';
import type { RepoId } from '@core/domain/repository';

export interface LibraryPort {
  read: () => Promise<Library>;
  createSpace: (name: string) => Promise<Library>;
  renameSpace: (id: SpaceId, name: string) => Promise<Library>;
  deleteSpace: (id: SpaceId) => Promise<Library>;
  moveSpace: (id: SpaceId, toIndex: number) => Promise<Library>;
  setSpaceCollapsed: (id: SpaceId, collapsed: boolean) => Promise<Library>;
  addToSpace: (id: SpaceId, repo: RepoId) => Promise<Library>;
  removeFromSpace: (id: SpaceId, repo: RepoId) => Promise<Library>;
  setView: (view: LibraryView) => Promise<Library>;
  setSort: (sort: RepoSort) => Promise<Library>;
  setLayout: (layout: LibraryLayout) => Promise<Library>;
  setAvatar: (repo: RepoId, avatar: RepoAvatar | null) => Promise<Library>;
  recordOpening: (repo: RepoId, at?: number) => Promise<Library>;
  flush: () => Promise<void>;
}
