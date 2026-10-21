import { repositoryName, type Library } from '@core/domain/library';
import { OperationCancelledError } from '@core/domain/errors';
import type { CommitPageRequest } from '@core/domain/commit';
import type { RepoSummary } from '@core/domain/repository';
import type { GitPort } from '@core/ports/GitPort';
import type { SelectedRef } from '@features/working/workingStore';
import type { CommandItem } from '@ui/CommandPalette';

export type SearchView = 'repositories' | 'terminal' | 'working' | 'settings';
export type SearchScope = 'all' | 'view';
export type SearchKind =
  | 'actions'
  | 'spaces'
  | 'modes'
  | 'settings'
  | 'options'
  | 'repositories'
  | 'worktrees'
  | 'branches'
  | 'stashes'
  | 'tags'
  | 'messages'
  | 'authors'
  | 'wip'
  | 'files'
  | 'shas';
export interface SearchResult extends CommandItem {
  kind: SearchKind;
  matchTexts?: readonly string[];
}
export type SearchTarget = { repoId: string } & (
  | { kind: 'commit'; sha: string }
  | { kind: 'ref'; ref: SelectedRef; sha: string }
  | { kind: 'stash'; index: number; sha: string }
  | { kind: 'file'; path: string; source: 'worktree' | 'index' | 'head'; sha?: string }
);
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
export function orderedRepositories(repos: readonly RepoSummary[]): RepoSummary[] {
  return [...repos].sort(
    (a, b) =>
      (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) ||
      a.name.localeCompare(b.name) ||
      a.path.localeCompare(b.path),
  );
}
// Reads that cannot kill their native subprocess still share one slot across
// query generations. Aborted generations leave the queue without touching disk.
let diskQueue: Promise<void> = Promise.resolve();
async function read<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  const previous = diskQueue;
  let release!: () => void;
  diskQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    if (signal.aborted) throw new OperationCancelledError();
    return await operation();
  } finally {
    release();
  }
}

export interface SearchContext {
  category?: SearchKind;
  preview?: boolean;
  refsCache?: Map<string, Awaited<ReturnType<GitPort['readRefs']>>>;
  view: SearchView;
  scope: SearchScope;
  query: string;
  activeRepo?: string;
  repositories: readonly RepoSummary[];
  aliases?: Library['aliases'];
  app: readonly SearchResult[];
  git: GitPort;
  signal: AbortSignal;
  open: (repo: RepoSummary, target?: SearchTarget) => void;
  openWorktree: (path: string) => void;
  onError: (repo: RepoSummary, error: unknown) => void;
}
export function matchQuality(value: string, query: string): number {
  const text = fold(value.trim());
  const needle = fold(query.trim());
  if (!needle) return 0;
  if (text === needle) return 300;
  if (text.startsWith(needle)) return 200;
  if (text.split(/[\s/_.-]+/u).some((word) => word.startsWith(needle))) return 150;
  return text.includes(needle) ? 100 : 0;
}
export function resultQuality(result: SearchResult, query: string): number {
  return Math.max(
    matchQuality(result.label, query),
    ...(result.matchTexts ?? []).map((text) => matchQuality(text, query)),
  );
}
export function searchKinds(view: SearchView): SearchKind[] {
  if (view === 'settings')
    return [
      'settings',
      'options',
      'spaces',
      'modes',
      'actions',
      'repositories',
      'worktrees',
      'branches',
      'tags',
      'stashes',
      'messages',
      'authors',
      'wip',
      'files',
      'shas',
    ];
  if (view === 'working')
    return [
      'branches',
      'worktrees',
      'messages',
      'stashes',
      'tags',
      'authors',
      'wip',
      'files',
      'shas',
      'repositories',
      'spaces',
      'modes',
      'settings',
      'options',
      'actions',
    ];
  return [
    'spaces',
    'repositories',
    'worktrees',
    'modes',
    'settings',
    'options',
    'actions',
    'branches',
    'stashes',
    'tags',
    'wip',
    'files',
    'messages',
    'authors',
    'shas',
  ];
}
export function rankResults(
  results: readonly SearchResult[],
  query: string,
  view: SearchView,
): SearchResult[] {
  const kinds = searchKinds(view);
  return [...results].sort(
    (a, b) =>
      resultQuality(b, query) - resultQuality(a, query) ||
      kinds.indexOf(a.kind) - kinds.indexOf(b.kind),
  );
}
interface Checkpoint {
  checkpoint: true;
  more: boolean;
}
type SearchEvent = SearchResult | Checkpoint;
/** Every expensive source yields a checkpoint so a sparse history cannot starve other kinds. */
async function* searchEvents(context: SearchContext): AsyncGenerator<SearchEvent> {
  const { view, scope, git, signal, open, onError } = context;
  const needle = fold(context.query.trim());
  const matches = (text: string) => fold(text).includes(needle);
  const repos = orderedRepositories(context.repositories);
  const name = (repo: RepoSummary) => repositoryName(repo, context.aliases);
  const refRepos = repos.filter(
    (repo) => !repo.worktreeOf || !repos.some((parent) => parent.id === repo.worktreeOf),
  );
  const active = repos.find((repo) => repo.id === context.activeRepo);
  const refs = context.refsCache ?? new Map<string, Awaited<ReturnType<GitPort['readRefs']>>>();
  const seen = new Set<string>();
  const byQuality = (a: string, b: string) =>
    matchQuality(b, context.query) - matchQuality(a, context.query);
  const app = function* (kinds: readonly SearchKind[]) {
    for (const kind of kinds)
      for (const item of rankResults(context.app, context.query, view)) {
        if (item.kind === kind && (matches(item.label) || item.matchTexts?.some(matches)))
          yield item;
      }
  };
  const names = function* () {
    for (const repo of [...repos].sort((a, b) => byQuality(name(a), name(b))))
      if (!repo.worktreeOf && (matches(name(repo)) || matches(repo.name) || matches(repo.path))) {
        yield {
          key: `repo:${repo.id}`,
          kind: 'repositories' as const,
          label: name(repo),
          matchTexts: [repo.name, repo.path],
          description: repo.path,
          onSelect: () => open(repo),
        };
      }
  };
  const data = async function* (
    kind: SearchKind,
    targets: readonly RepoSummary[],
  ): AsyncGenerator<SearchEvent> {
    if (!needle) return; // Opening the palette must never crawl disk.
    for (const repo of targets) {
      if (signal.aborted) return;
      try {
        const item = (key: string, label: string, target: SearchTarget): SearchResult => ({
          key: `${repo.id}:${kind}:${key}`,
          kind,
          label,
          ...(target.kind === 'file'
            ? { matchTexts: [target.path.split('/').at(-1) ?? target.path] }
            : {}),
          description:
            target.kind === 'commit' ? `${name(repo)} · ${target.sha.slice(0, 8)}` : name(repo),
          onSelect: () => open(repo, target),
        });
        if (['worktrees', 'branches', 'stashes', 'tags'].includes(kind)) {
          let snapshot = refs.get(repo.id);
          if (!snapshot) {
            snapshot = await read(signal, () => git.readRefs(repo.id, { signal }));
            refs.set(repo.id, snapshot);
          }
          if (kind === 'worktrees' && snapshot.worktrees.length > 1) {
            for (const wt of [...snapshot.worktrees].sort((a, b) => byQuality(a.name, b.name)))
              if (!wt.missing && matches(wt.name))
                yield {
                  key: `worktree:${wt.path}`,
                  kind,
                  label: wt.name,
                  description: `${name(repo)} · ${wt.path}`,
                  onSelect: () => context.openWorktree(wt.path),
                };
          }
          if (kind === 'branches')
            for (const branch of [...snapshot.branches].sort((a, b) => byQuality(a.name, b.name)))
              if (matches(branch.name))
                yield item(branch.id, branch.name, {
                  repoId: repo.id,
                  kind: 'ref',
                  ref: {
                    kind: branch.kind === 'local' ? 'localBranch' : 'remoteBranch',
                    name: branch.name,
                    target: branch.tip,
                    isHead: branch.isHead,
                    ...(branch.remote ? { remote: branch.remote } : {}),
                  },
                  sha: branch.tip,
                });
          if (kind === 'stashes')
            for (const stash of [...snapshot.stashes].sort((a, b) =>
              byQuality(a.message, b.message),
            ))
              if (matches(stash.message))
                yield item(stash.sha, stash.message, {
                  repoId: repo.id,
                  kind: 'stash',
                  index: stash.index,
                  sha: stash.sha,
                });
          if (kind === 'tags')
            for (const tag of [...snapshot.tags].sort((a, b) => byQuality(a.name, b.name)))
              if (matches(tag.name))
                yield item(tag.id, tag.name, {
                  repoId: repo.id,
                  kind: 'ref',
                  ref: { kind: 'tag', name: tag.name, target: tag.target, isHead: false },
                  sha: tag.target,
                });
        } else if (kind === 'wip') {
          const status = await read(signal, () => git.readStatus(repo.id, { signal }));
          const files = [
            ...status.unstaged.map((file) => ({ file, source: 'worktree' as const })),
            ...status.conflicted.map((file) => ({ file, source: 'worktree' as const })),
            ...status.staged.map((file) => ({ file, source: 'index' as const })),
          ];
          const paths = new Set<string>();
          files.sort((a, b) =>
            byQuality(
              a.file.path.split('/').at(-1) ?? a.file.path,
              b.file.path.split('/').at(-1) ?? b.file.path,
            ),
          );
          for (const { file, source } of files)
            if (!paths.has(file.path) && matches(file.path)) {
              paths.add(file.path);
              yield item(file.path, file.path, {
                repoId: repo.id,
                kind: 'file',
                path: file.path,
                source,
              });
            }
        } else if (kind === 'files') {
          let snapshot = refs.get(repo.id);
          if (!snapshot) {
            snapshot = await read(signal, () => git.readRefs(repo.id, { signal }));
            refs.set(repo.id, snapshot);
          }
          if (!snapshot.head.sha) continue;
          const headSha = snapshot.head.sha;
          const tree = await read(signal, () => git.readTree(repo.id, headSha, { signal }));
          const matchedFiles: (typeof tree)[number][] = [];
          let scannedFiles = 0;
          for (const file of tree) {
            if (++scannedFiles % 256 === 0) {
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              if (signal.aborted) return;
            }
            if (file.kind === 'file' && matches(file.path)) matchedFiles.push(file);
          }
          matchedFiles.sort((a, b) =>
            byQuality(a.path.split('/').at(-1) ?? a.path, b.path.split('/').at(-1) ?? b.path),
          );
          for (const file of matchedFiles) {
            yield item(file.path, file.path, {
              repoId: repo.id,
              kind: 'file',
              path: file.path,
              source: 'head',
              sha: snapshot.head.sha,
            });
          }
        } else if (kind === 'messages' || kind === 'authors' || kind === 'shas') {
          const authors = new Set<string>();
          let skip = 0;
          let scanSkip = 0;
          while (!signal.aborted) {
            const search: NonNullable<CommitPageRequest['search']> = {
              field: kind,
              text: context.query.trim(),
              ...(context.preview ? { scanSkip, scanLimit: 500 } : {}),
            };
            const page = await read(signal, () =>
              git.readCommits(repo.id, { skip, limit: 20, search }, { signal }),
            );
            const candidates: SearchResult[] = [];
            for (const commit of page.commits) {
              const author = `${commit.author.name} <${commit.author.email}>`;
              if (kind === 'authors' && authors.has(author)) continue;
              authors.add(author);
              const result = item(
                kind === 'authors' ? author : commit.sha,
                kind === 'messages' ? commit.summary : kind === 'authors' ? author : commit.sha,
                { repoId: repo.id, kind: 'commit', sha: commit.sha },
              );
              result.matchTexts =
                kind === 'messages'
                  ? [commit.summary, commit.body]
                  : kind === 'authors'
                    ? [commit.author.name, commit.author.email]
                    : [commit.sha];
              candidates.push(result);
            }
            for (const result of rankResults(candidates, context.query, view)) yield result;
            if (context.preview)
              yield {
                checkpoint: true,
                more: page.hasMore || targets.indexOf(repo) < targets.length - 1,
              };
            if (!page.hasMore) break;
            if (page.searchCursor !== undefined) scanSkip = page.searchCursor;
            if (!context.preview) skip += page.commits.length;
          }
        }
        if (context.preview && !['messages', 'authors', 'shas'].includes(kind))
          yield { checkpoint: true, more: targets.indexOf(repo) < targets.length - 1 };
      } catch (error) {
        if (signal.aborted) return;
        onError(repo, error);
      }
    }
  };
  const sources: (AsyncGenerator<SearchEvent> | Generator<SearchResult>)[] = [];
  const allowed = (kind: SearchKind) => !context.category || context.category === kind;
  const addApp = (kinds: SearchKind[]) => {
    sources.push(app(kinds.filter(allowed)));
  };
  const addData = (
    kind: SearchKind,
    targets = ['branches', 'worktrees', 'stashes', 'tags'].includes(kind) ? refRepos : repos,
  ) => {
    if (allowed(kind)) sources.push(data(kind, targets));
  };
  const addNames = () => {
    if (allowed('repositories')) sources.push(names());
    addData('worktrees');
  };
  const local = (view === 'working' || view === 'terminal') && active;
  if (local) {
    for (const kind of [
      'branches',
      'worktrees',
      'messages',
      'stashes',
      'tags',
      'authors',
      'wip',
      'files',
      'shas',
    ] as const)
      addData(kind, [active]);
    addApp(['modes', 'actions']);
  } else if (view === 'settings') {
    addApp(['settings', 'options', 'modes', 'actions']);
  } else {
    addApp(['spaces']);
    addNames();
    addApp(['modes', 'actions']);
  }
  if (scope === 'all') {
    if (local || view === 'settings') {
      addApp(['spaces']);
      addNames();
    }
    if (view !== 'settings') addApp(['settings', 'options']);
    const others = local ? repos.filter((repo) => repo.id !== active.id) : repos;
    const otherRefs = refRepos.filter((repo) => !local || repo.id !== active.id);
    for (const kind of ['branches', 'stashes', 'tags'] as const) addData(kind, otherRefs);
    for (const kind of ['wip', 'files', 'messages', 'authors', 'shas'] as const)
      addData(kind, others);
  }
  let scanned = 0;
  for (const source of sources)
    for await (const result of source) {
      if (signal.aborted) return;
      if ('checkpoint' in result) {
        yield result;
        continue;
      }
      if (seen.has(result.key)) continue;
      seen.add(result.key);
      yield result;
      if (++scanned % 20 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
}

/** Full category traversal, used by focused callers and tests. */
export async function* searchResults(context: SearchContext): AsyncGenerator<SearchResult> {
  for await (const event of searchEvents(context)) if (!('checkpoint' in event)) yield event;
}
export interface SearchBatch {
  kind: SearchKind;
  items: SearchResult[];
  hasMore: boolean;
}
export function createSearchSession(context: SearchContext) {
  const refsCache = new Map<string, Awaited<ReturnType<GitPort['readRefs']>>>();
  const iterators = new Map<SearchKind, AsyncGenerator<SearchEvent>>();
  const complete = new Set<SearchKind>();
  const yieldedSinceCheckpoint = new Set<SearchKind>();
  const next = async (kind: SearchKind, limit = 10): Promise<SearchBatch> => {
    const items: SearchResult[] = [];
    if (complete.has(kind) || context.signal.aborted) return { kind, items, hasMore: false };
    let iterator = iterators.get(kind);
    if (!iterator) {
      iterator = searchEvents({ ...context, refsCache, category: kind, preview: true });
      iterators.set(kind, iterator);
    }
    while (items.length < limit && !context.signal.aborted) {
      const result = await iterator.next();
      if (result.done) {
        complete.add(kind);
        break;
      }
      if ('checkpoint' in result.value) {
        const progressed = yieldedSinceCheckpoint.delete(kind);
        if (result.value.more && (items.length > 0 || !progressed)) break;
        continue;
      }
      items.push(result.value);
      yieldedSinceCheckpoint.add(kind);
    }
    return { kind, items, hasMore: !complete.has(kind) };
  };
  return {
    next,
    async *preview(): AsyncGenerator<SearchBatch> {
      let count = 0;
      const populated: SearchKind[] = [];
      for (const kind of searchKinds(context.view)) {
        if (context.signal.aborted) return;
        const batch = await next(kind, 3);
        count += batch.items.length;
        if (batch.items.length && batch.hasMore) populated.push(kind);
        yield batch;
      }
      // Fill a short mixed list from categories already known to contain matches.
      // Empty history windows remain deferred instead of forcing a deeper scan.
      for (const kind of populated) {
        if (context.signal.aborted || count >= 10) return;
        const batch = await next(kind, 10 - count);
        count += batch.items.length;
        yield batch;
      }
    },
  };
}
