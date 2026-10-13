import type { RepoId } from './repository';

export const REPO_SORTS = ['name', 'lastOpened'] as const;
export type RepoSort = (typeof REPO_SORTS)[number];
export const LIBRARY_LAYOUTS = ['list', 'spaces'] as const;
export type LibraryLayout = (typeof LIBRARY_LAYOUTS)[number];
export type SpaceId = string;

export interface Space {
  id: SpaceId;
  name: string;
  /** Miembros en orden de incorporación; un repositorio puede vivir en varios espacios. */
  repos: readonly RepoId[];
  collapsed?: boolean;
}

export type LibraryView = { kind: 'recent' } | { kind: 'all' } | { kind: 'space'; id: SpaceId };

export interface RepoAvatar {
  glyph: string;
  tone: number;
  /** Color libre elegido por el usuario; el tono queda como respaldo compatible. */
  color?: string;
}

/** Preferencias y métricas locales de la biblioteca; los repos viven en GitPort. */
export interface Library {
  spaces: readonly Space[];
  view: LibraryView;
  sort: RepoSort;
  layout: LibraryLayout;
  avatars: Readonly<Record<RepoId, RepoAvatar>>;
  /** Aperturas agregadas por día, nunca repositorios concretos. */
  usage: Readonly<Record<string, number>>;
}

export const DEFAULT_LIBRARY: Library = {
  spaces: [],
  view: { kind: 'recent' },
  sort: 'lastOpened',
  layout: 'list',
  avatars: {},
  usage: {},
};
export const USAGE_MONTHS = 14;

export function isoDay(at: number): string {
  const date = new Date(at);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
}

function usageCutoff(now: number): string {
  const date = new Date(now);
  date.setDate(1);
  date.setMonth(date.getMonth() - USAGE_MONTHS);
  return isoDay(date.getTime());
}

export function pruneUsage(
  usage: Readonly<Record<string, number>>,
  now: number,
): Readonly<Record<string, number>> {
  const cutoff = usageCutoff(now);
  return Object.fromEntries(Object.entries(usage).filter(([day]) => day >= cutoff));
}

export function setSort(library: Library, sort: RepoSort): Library {
  return library.sort === sort ? library : { ...library, sort };
}

export function setLayout(library: Library, layout: LibraryLayout): Library {
  return library.layout === layout ? library : { ...library, layout };
}

export function setView(library: Library, view: LibraryView): Library {
  if (view.kind === 'space' && !library.spaces.some((space) => space.id === view.id))
    return library;
  if (
    library.view.kind === view.kind &&
    (library.view.kind !== 'space' || (view.kind === 'space' && library.view.id === view.id))
  ) {
    return library;
  }
  return { ...library, view };
}

export function nextSpaceId(spaces: readonly Space[]): SpaceId {
  const highest = spaces.reduce((top, space) => {
    const value = Number.parseInt(space.id.replace(/^space-/, ''), 10);
    return Number.isFinite(value) ? Math.max(top, value) : top;
  }, 0);
  return `space-${String(highest + 1)}`;
}

export function createSpace(library: Library, name: string): Library {
  const clean = name.trim();
  if (clean === '' || library.spaces.some((space) => space.name === clean)) return library;
  return {
    ...library,
    spaces: [...library.spaces, { id: nextSpaceId(library.spaces), name: clean, repos: [] }],
  };
}

export function renameSpace(library: Library, id: SpaceId, name: string): Library {
  const clean = name.trim();
  if (
    clean === '' ||
    !library.spaces.some((space) => space.id === id) ||
    library.spaces.some((space) => space.id !== id && space.name === clean)
  ) {
    return library;
  }
  return {
    ...library,
    spaces: library.spaces.map((space) => (space.id === id ? { ...space, name: clean } : space)),
  };
}

export function deleteSpace(library: Library, id: SpaceId): Library {
  if (!library.spaces.some((space) => space.id === id)) return library;
  const selected = library.view.kind === 'space' && library.view.id === id;
  return {
    ...library,
    spaces: library.spaces.filter((space) => space.id !== id),
    view: selected ? DEFAULT_LIBRARY.view : library.view,
  };
}

export function moveSpace(library: Library, id: SpaceId, toIndex: number): Library {
  const from = library.spaces.findIndex((space) => space.id === id);
  const to = Math.min(Math.max(Math.floor(toIndex), 0), library.spaces.length - 1);
  if (from < 0 || from === to) return library;
  const spaces = [...library.spaces];
  const [moved] = spaces.splice(from, 1);
  if (!moved) return library;
  spaces.splice(to, 0, moved);
  return { ...library, spaces };
}

export function setSpaceCollapsed(library: Library, id: SpaceId, collapsed: boolean): Library {
  const space = library.spaces.find((candidate) => candidate.id === id);
  if (!space || (space.collapsed ?? false) === collapsed) return library;
  return {
    ...library,
    spaces: library.spaces.map((candidate) => {
      if (candidate.id !== id) return candidate;
      if (collapsed) return { ...candidate, collapsed: true };
      const { collapsed: _expanded, ...expanded } = candidate;
      return expanded;
    }),
  };
}

export function addToSpace(library: Library, id: SpaceId, repo: RepoId): Library {
  return addManyToSpace(library, id, [repo]);
}

/** Adds a selection without moving its members out of any other space. */
export function addManyToSpace(
  library: Library,
  id: SpaceId,
  repos: readonly RepoId[],
  reveal = false,
): Library {
  const space = library.spaces.find((candidate) => candidate.id === id);
  if (!space) return library;
  const existing = new Set(space.repos);
  const additions = [...new Set(repos)].filter((repo) => !existing.has(repo));
  const added =
    additions.length === 0
      ? library
      : {
          ...library,
          spaces: library.spaces.map((candidate) =>
            candidate.id === id
              ? { ...candidate, repos: [...candidate.repos, ...additions] }
              : candidate,
          ),
        };
  return reveal
    ? setView(setSpaceCollapsed(setLayout(added, 'spaces'), id, false), { kind: 'space', id })
    : added;
}

/** Creation, membership and navigation are persisted as one library change. */
export function createSpaceAndAddMany(
  library: Library,
  name: string,
  repos: readonly RepoId[],
): Library {
  const created = createSpace(library, name);
  if (created === library) return library;
  const space = created.spaces[created.spaces.length - 1];
  return space ? addManyToSpace(created, space.id, repos, true) : library;
}

export function removeFromSpace(library: Library, id: SpaceId, repo: RepoId): Library {
  return removeManyFromSpaces(library, [repo], [id]);
}

/** Removes memberships only; an omitted scope includes every space. */
export function removeManyFromSpaces(
  library: Library,
  repos: readonly RepoId[],
  spaceIds?: readonly SpaceId[],
): Library {
  const targets = spaceIds === undefined ? null : new Set(spaceIds);
  const removed = new Set(repos);
  let changed = false;
  const spaces = library.spaces.map((space) => {
    if (targets !== null && !targets.has(space.id)) return space;
    if (!space.repos.some((repo) => removed.has(repo))) return space;
    changed = true;
    return { ...space, repos: space.repos.filter((repo) => !removed.has(repo)) };
  });
  return changed ? { ...library, spaces } : library;
}

export function setAvatar(library: Library, repo: RepoId, avatar: RepoAvatar | null): Library {
  const current = library.avatars[repo];
  if (avatar === null) {
    if (current === undefined) return library;
    const { [repo]: _removed, ...avatars } = library.avatars;
    return { ...library, avatars };
  }
  if (
    current?.glyph === avatar.glyph &&
    current.tone === avatar.tone &&
    current.color === avatar.color
  )
    return library;
  return { ...library, avatars: { ...library.avatars, [repo]: avatar } };
}

export function recordOpening(library: Library, at: number): Library {
  const day = isoDay(at);
  return {
    ...library,
    usage: pruneUsage({ ...library.usage, [day]: (library.usage[day] ?? 0) + 1 }, at),
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function members(value: unknown): readonly RepoId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter((entry) => entry !== ''))];
}

function spaces(value: unknown): readonly Space[] {
  if (!Array.isArray(value)) return [];
  const found: Space[] = [];
  const ids = new Set<SpaceId>();
  const names = new Set<string>();
  for (const entry of value) {
    const raw = record(entry);
    const id = text(raw['id']);
    const name = text(raw['name']);
    if (id === '' || name === '' || ids.has(id) || names.has(name)) continue;
    ids.add(id);
    names.add(name);
    found.push({
      id,
      name,
      repos: members(raw['repos']),
      ...(raw['collapsed'] === true ? { collapsed: true } : {}),
    });
  }
  return found;
}

function view(value: unknown, known: readonly Space[]): LibraryView {
  const raw = record(value);
  if (raw['kind'] === 'all') return { kind: 'all' };
  if (raw['kind'] === 'recent') return { kind: 'recent' };
  const id = text(raw['id']);
  return raw['kind'] === 'space' && known.some((space) => space.id === id)
    ? { kind: 'space', id }
    : DEFAULT_LIBRARY.view;
}

function avatars(value: unknown): Readonly<Record<RepoId, RepoAvatar>> {
  const chosen: Record<RepoId, RepoAvatar> = {};
  for (const [repo, entry] of Object.entries(record(value))) {
    const raw = record(entry);
    const glyph = typeof raw['glyph'] === 'string' ? raw['glyph'].trim() : '';
    const tone = raw['tone'];
    if (repo.trim() === '' || glyph === '') continue;
    if (typeof tone !== 'number' || !Number.isFinite(tone) || tone < 1) continue;
    const color = typeof raw['color'] === 'string' ? raw['color'].trim() : '';
    chosen[repo] = {
      glyph,
      tone: Math.floor(tone),
      ...(/^#[\da-f]{6}$/i.test(color) ? { color: color.toLowerCase() } : {}),
    };
  }
  return chosen;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function usage(value: unknown, now: number): Readonly<Record<string, number>> {
  const days: Record<string, number> = {};
  for (const [day, count] of Object.entries(record(value))) {
    if (!ISO_DAY.test(day)) continue;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) continue;
    days[day] = Math.floor(count);
  }
  return pruneUsage(days, now);
}

/** Acepta tanto `library.json` como el antiguo `workspace.json`. */
export function normalizeLibrary(value: unknown, now: number = Date.now()): Library {
  const raw = record(value);
  const known = spaces(raw['spaces']);
  return {
    spaces: known,
    view: view(raw['view'], known),
    sort: (REPO_SORTS as readonly unknown[]).includes(raw['sort'])
      ? (raw['sort'] as RepoSort)
      : DEFAULT_LIBRARY.sort,
    layout: (LIBRARY_LAYOUTS as readonly unknown[]).includes(raw['layout'])
      ? (raw['layout'] as LibraryLayout)
      : DEFAULT_LIBRARY.layout,
    avatars: avatars(raw['avatars']),
    usage: usage(raw['usage'], now),
  };
}
