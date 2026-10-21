import { repositoryName } from '@core/domain/library';
import type { RepoId } from '@core/domain/repository';

import { useRepositoriesStore } from './repositoriesStore';

/** Resolves the current local alias without changing the canonical repository data. */
export function useRepositoryName(id: RepoId, name: string): string {
  return useRepositoriesStore((state) => repositoryName({ id, name }, state.library?.aliases));
}
