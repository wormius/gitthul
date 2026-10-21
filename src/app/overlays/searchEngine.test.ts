import { describe, expect, it, vi } from 'vitest';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import type { RepoSummary } from '@core/domain/repository';
import type { RefsSnapshot } from '@core/domain/refs';
import {
  orderedRepositories,
  createSearchSession,
  rankResults,
  matchQuality,
  searchResults,
  type SearchResult,
  type SearchView,
} from './searchEngine';

const repo = (name: string, lastOpenedAt: number | null = null): RepoSummary => ({
  id: name,
  name,
  path: `/${name}`,
  head: 'main',
  lastOpenedAt,
});
const snapshot: RefsSnapshot = {
  head: { branch: 'main', sha: 'abc', detached: false },
  branches: [
    {
      id: 'refs/heads/match',
      name: 'match',
      tip: 'abc',
      kind: 'local',
      isHead: true,
      ahead: 0,
      behind: 0,
    },
  ],
  tags: [{ id: 'refs/tags/match', name: 'match', target: 'abc', annotated: false }],
  stashes: [
    {
      index: 0,
      sha: 'stash',
      base: 'abc',
      message: 'match',
      branch: 'main',
      createdAt: 0,
      fileCount: 1,
    },
  ],
  worktrees: [
    {
      path: '/match',
      name: 'match',
      branch: 'main',
      head: 'abc',
      isMain: true,
      locked: false,
      missing: false,
    },
    {
      path: '/other',
      name: 'match other',
      branch: 'other',
      head: 'def',
      isMain: false,
      locked: false,
      missing: false,
    },
  ],
  remotes: [],
};
function context(view: SearchView = 'repositories') {
  const git = createMockGitPort({ latency: NO_LATENCY });
  vi.spyOn(git, 'readRefs').mockResolvedValue(snapshot);
  vi.spyOn(git, 'readStatus').mockResolvedValue({
    clean: false,
    staged: [],
    conflicted: [],
    unstaged: [
      { path: 'match.txt', change: 'modified', binary: false, insertions: 1, deletions: 0 },
    ],
  });
  vi.spyOn(git, 'readTree').mockResolvedValue([{ path: 'match.txt', kind: 'file' }]);
  vi.spyOn(git, 'readCommits').mockImplementation((_id, request) =>
    Promise.resolve({
      commits: [
        {
          sha: 'abc',
          summary: 'match',
          body: '',
          parents: [],
          author: { name: 'match', email: 'match@example.com' },
          committer: { name: 'match', email: 'match@example.com' },
          authoredAt: 0,
          committedAt: 0,
        },
      ],
      total: 1,
      hasMore: false,
      ...(request?.search?.field === 'shas' ? { commits: [] } : {}),
    }),
  );
  const app: SearchResult[] = (['spaces', 'modes', 'settings', 'options'] as const).map((kind) => ({
    key: kind,
    label: 'match',
    kind,
    onSelect: vi.fn(),
  }));
  return {
    view,
    scope: 'all' as const,
    query: 'match',
    activeRepo: 'match',
    repositories: [repo('match')],
    app,
    git,
    signal: new AbortController().signal,
    open: vi.fn(),
    openWorktree: vi.fn(),
    onError: vi.fn(),
  };
}
async function collect(iterator: AsyncGenerator<SearchResult>) {
  const results: SearchResult[] = [];
  for await (const result of iterator) results.push(result);
  return results;
}
describe('search relevance and scope', () => {
  it('ranks exact messages above partial branches, preserving context for ties', () => {
    const candidates: SearchResult[] = [
      { key: 'branch', kind: 'branches', label: 'fix/main', onSelect: vi.fn() },
      { key: 'message', kind: 'messages', label: 'main', onSelect: vi.fn() },
      { key: 'tag', kind: 'tags', label: 'main', onSelect: vi.fn() },
    ];
    expect(rankResults(candidates, 'MAIN', 'working').map((item) => item.key)).toEqual([
      'message',
      'tag',
      'branch',
    ]);
    expect(matchQuality('Corrección', 'correccion')).toBe(300);
    expect(matchQuality('main-next', 'main')).toBeGreaterThan(matchQuality('fix/main', 'main'));
  });
  it('ranks a file basename and an author name as exact matches', () => {
    const file: SearchResult = {
      key: 'file',
      kind: 'files',
      label: 'src/main.ts',
      matchTexts: ['main.ts'],
      onSelect: vi.fn(),
    };
    expect(
      rankResults(
        [file, { ...file, key: 'partial', matchTexts: [], label: 'docs/main.ts.old' }],
        'main.ts',
        'working',
      )[0]?.key,
    ).toBe('file');
  });
  it('limits this view in settings to settings and navigation without disk reads', async () => {
    const ctx = context('settings');
    const results = await collect(searchResults({ ...ctx, scope: 'view' }));
    expect(results.map((item) => item.kind)).toEqual(['settings', 'options', 'modes']);
    expect(ctx.git.readRefs).not.toHaveBeenCalled();
    expect(ctx.git.readCommits).not.toHaveBeenCalled();
  });
  it('searches only the active repository in this view, including terminal context', async () => {
    for (const view of ['working', 'terminal'] as const) {
      const ctx = context(view);
      ctx.repositories.push(repo('other'));
      const results = await collect(searchResults({ ...ctx, scope: 'view' }));
      expect(results.some((item) => item.kind === 'messages')).toBe(true);
      expect(vi.mocked(ctx.git.readCommits).mock.calls.every(([id]) => id === 'match')).toBe(true);
      expect(ctx.git.readTree).toHaveBeenCalledWith('match', 'abc', { signal: ctx.signal });
    }
  });
  it('all GitThul includes other repository histories and files', async () => {
    const ctx = context('settings');
    ctx.repositories.push(repo('other'));
    const results = await collect(searchResults(ctx));
    expect(results.some((item) => item.key.startsWith('other:messages:'))).toBe(true);
    expect(results.some((item) => item.key.startsWith('other:files:'))).toBe(true);
  });
  it('samples categories so many commits cannot hide an exact file match', async () => {
    const ctx = context('working');
    vi.mocked(ctx.git.readCommits).mockResolvedValue({
      commits: [],
      total: 0,
      hasMore: true,
      searchCursor: 500,
    });
    const session = createSearchSession({ ...ctx, scope: 'view' });
    const batches = [];
    for await (const batch of session.preview()) batches.push(batch);
    expect(batches.find((batch) => batch.kind === 'messages')).toMatchObject({
      items: [],
      hasMore: true,
    });
    expect(batches.find((batch) => batch.kind === 'files')?.items).toHaveLength(1);
    expect(ctx.git.readCommits).toHaveBeenCalledTimes(3);
    expect(vi.mocked(ctx.git.readCommits).mock.calls[0]?.[1]?.search).toMatchObject({
      scanSkip: 0,
      scanLimit: 500,
    });
    await session.next('messages');
    expect(vi.mocked(ctx.git.readCommits).mock.calls.at(-1)?.[1]?.search).toMatchObject({
      scanSkip: 500,
    });
  });
  it('resumes bounded history with a scan cursor without skipping matches again', async () => {
    const ctx = context('working');
    const template = (await ctx.git.readCommits('match')).commits[0]!;
    vi.mocked(ctx.git.readCommits)
      .mockClear()
      .mockImplementation((_id, request) => {
        const cursor = request?.search?.scanSkip ?? 0;
        return Promise.resolve({
          commits: Array.from({ length: 20 }, (_, index) => ({
            ...template,
            sha: `${cursor + index}`,
          })),
          total: 20,
          hasMore: cursor === 0,
          searchCursor: cursor + 20,
        });
      });
    const session = createSearchSession({ ...ctx, scope: 'view' });
    await session.next('messages', 20);
    const next = await session.next('messages', 20);
    expect(next.items[0]?.key).toBe('match:messages:20');
    expect(vi.mocked(ctx.git.readCommits).mock.calls.at(-1)?.[1]).toMatchObject({
      skip: 0,
      search: { scanSkip: 20 },
    });
  });
  it('expands a category without advancing unrelated sources or duplicating results', async () => {
    const ctx = context('working');
    const many = {
      ...snapshot,
      branches: Array.from({ length: 15 }, (_, index) => ({
        ...snapshot.branches[0]!,
        id: `refs/heads/match${index}`,
        name: `match${index}`,
      })),
    };
    vi.mocked(ctx.git.readRefs).mockResolvedValue(many);
    const session = createSearchSession(ctx);
    const first = await session.next('branches', 3);
    const second = await session.next('branches', 10);
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(10);
    expect(new Set([...first.items, ...second.items].map((item) => item.key)).size).toBe(13);
    expect(ctx.git.readCommits).not.toHaveBeenCalled();
    expect(ctx.git.readRefs).toHaveBeenCalledTimes(1);
  });
  it('does not crawl disk for an empty query', async () => {
    const ctx = { ...context(), query: '' };
    await collect(searchResults(ctx));
    expect(ctx.git.readRefs).not.toHaveBeenCalled();
    expect(ctx.git.readCommits).not.toHaveBeenCalled();
  });
  it('cancels stale searches and serializes reads across generations', async () => {
    const ctx = context('working');
    let finish!: (refs: RefsSnapshot) => void;
    vi.mocked(ctx.git.readRefs).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const first = searchResults({ ...ctx, signal: controller.signal });
    const pendingFirst = first.next();
    await vi.waitFor(() => expect(finish).toBeDefined());
    controller.abort();
    const second = searchResults(ctx);
    const pendingSecond = second.next();
    await Promise.resolve();
    expect(ctx.git.readRefs).toHaveBeenCalledTimes(1);
    finish(snapshot);
    expect((await pendingFirst).done).toBe(true);
    const next = await pendingSecond;
    if (next.done) throw new Error('Expected a branch');
    expect(next.value.kind).toBe('branches');
    await second.return(undefined);
  });
  it('reports inaccessible sources and continues', async () => {
    const ctx = context('working');
    vi.mocked(ctx.git.readStatus).mockRejectedValue(new Error('missing'));
    const results = await collect(searchResults(ctx));
    expect(results.some((item) => item.kind === 'files')).toBe(true);
    expect(ctx.onError).toHaveBeenCalledTimes(1);
  });
  it('orders repository traversal by recent opening and then name', () => {
    expect(
      orderedRepositories([repo('z'), repo('b', 20), repo('a'), repo('c', 30)]).map(
        (item) => item.name,
      ),
    ).toEqual(['c', 'b', 'a', 'z']);
  });
});

it('finds local aliases, original names and paths while opening the canonical repository', async () => {
  const ctx = { ...context(), aliases: { match: 'Product' } };
  for (const query of ['Product', 'match', '/match']) {
    const results = await collect(searchResults({ ...ctx, query }));
    const result = results.find((item) => item.kind === 'repositories');
    expect(result?.label).toBe('Product');
    result?.onSelect?.();
    expect(ctx.open).toHaveBeenLastCalledWith(ctx.repositories[0]);
  }
  expect(ctx.repositories[0]?.name).toBe('match');
});
