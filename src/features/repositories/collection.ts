import type { RepoSort, Space, SpaceId } from '@core/domain/library';
import type { RepoId, RepoSummary } from '@core/domain/repository';

export const RECENT_LIMIT = 5;

export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function matchesQuery(repo: RepoSummary, needle: string): boolean {
  return fold(repo.name).includes(needle) || fold(repo.path).includes(needle);
}

export function filterRepositories(
  repositories: readonly RepoSummary[],
  query: string,
): readonly RepoSummary[] {
  const needle = fold(query.trim());
  return needle === '' ? repositories : repositories.filter((repo) => matchesQuery(repo, needle));
}

export function sortRepositories(
  repositories: readonly RepoSummary[],
  sort: RepoSort,
  collator: Intl.Collator,
): readonly RepoSummary[] {
  const ordered = [...repositories];
  if (sort === 'name') {
    ordered.sort(
      (left, right) =>
        collator.compare(left.name, right.name) || collator.compare(left.path, right.path),
    );
  } else {
    ordered.sort(
      (left, right) =>
        (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0) ||
        collator.compare(left.name, right.name),
    );
  }
  return ordered;
}

export function recentRepositories(
  repositories: readonly RepoSummary[],
  limit: number = RECENT_LIMIT,
): readonly RepoSummary[] {
  return repositories
    .filter((repo) => repo.lastOpenedAt !== null)
    .sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0))
    .slice(0, limit);
}

export interface VisibleRequest {
  repositories: readonly RepoSummary[];
  sort: RepoSort;
  filter: string;
  collator: Intl.Collator;
}

export function visibleRepositories({
  repositories,
  sort,
  filter,
  collator,
}: VisibleRequest): readonly RepoSummary[] {
  return sortRepositories(filterRepositories(repositories, filter), sort, collator);
}

export function nextSelection(
  visible: readonly RepoSummary[],
  removed: RepoId,
): RepoSummary | null {
  const index = visible.findIndex((repo) => repo.id === removed);
  if (index < 0) return null;
  return visible[index + 1] ?? visible[index - 1] ?? null;
}

export type SpaceNameProblem = 'empty' | 'taken';

export function validateSpaceName(
  spaces: readonly Space[],
  name: string,
  exceptId?: SpaceId,
): SpaceNameProblem | null {
  const clean = name.trim();
  if (clean === '') return 'empty';
  return spaces.some((space) => space.id !== exceptId && space.name === clean) ? 'taken' : null;
}

export function spacesOf(spaces: readonly Space[], repo: RepoId): readonly Space[] {
  return spaces.filter((space) => space.repos.includes(repo));
}
