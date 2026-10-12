import { buildCommitRows } from '@features/working/commits';
import { buildGraph } from '@features/working/graph';
import { buildLargeRepo } from '@core/adapters/mock/fixture/large';

import { describe, expect, it } from 'vitest';

import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';

import {
  buildTerminalGraphEntries,
  buildTerminalGraphEntriesAsync,
  terminalGraphPalette,
  terminalGraphRows,
  terminalGraphRowsAsync,
  terminalCommitCommands,
  terminalShellArgument,
  terminalInsertOptionsAt,
} from './terminalGraph';

describe('terminalGraph', () => {
  it('prepara un historial grande con miles de referencias sin recorrerlas por cada commit', async () => {
    const { history, refs } = buildLargeRepo({ commitCount: 20_000, branchCount: 8 });
    const manyRefs = {
      ...refs,
      tags: history.commits.slice(0, 4_000).map((commit, index) => ({
        id: `refs/tags/v${index}`,
        name: `v${index}`,
        target: commit.sha,
        annotated: false,
      })),
    };
    const started = performance.now();
    const entries = await buildTerminalGraphEntriesAsync(history.commits, manyRefs);
    expect(entries).toHaveLength(history.commits.length);
    expect(entries[3_999]?.insertOptions).toContainEqual({
      key: 'refs/tags/v3999',
      kind: 'tag',
      value: 'v3999',
    });
    expect(entries.at(-1)?.commit).toBe(history.commits.at(-1));
    expect(performance.now() - started).toBeLessThan(2_000);
  });
  it('conserva el orden del historial y ancla las referencias a su commit', async () => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const [refs, page] = await Promise.all([
      git.readRefs('gitthul'),
      git.readCommits('gitthul', { limit: 100 }),
    ]);

    const entries = buildTerminalGraphEntries(page.commits, refs, '');

    expect(entries.map((entry) => entry.commit.sha)).toEqual(
      page.commits.map((commit) => commit.sha),
    );
    expect(entries.some((entry) => entry.labels.some((label) => label.refName === 'main'))).toBe(
      true,
    );
  });

  it('filtra por nombre real de referencia, SHA o mensaje', async () => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const [refs, page] = await Promise.all([
      git.readRefs('gitthul'),
      git.readCommits('gitthul', { limit: 100 }),
    ]);
    const entries = buildTerminalGraphEntries(page.commits, refs, '');
    const labeled = entries.find((entry) => entry.labels.length > 0)!;

    expect(
      buildTerminalGraphEntries(page.commits, refs, labeled.insertOptions[0]!.value),
    ).toContainEqual(labeled);
    expect(buildTerminalGraphEntries(page.commits, refs, labeled.commit.sha.slice(0, 10))).toEqual([
      labeled,
    ]);
    expect(buildTerminalGraphEntries(page.commits, refs, labeled.commit.summary)).toContainEqual(
      labeled,
    );
  });

  it('separa local, remota, tag y SHA aunque compartan el mismo nodo', async () => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const refs = await git.readRefs('gitthul');
    const local = refs.branches.find((branch) => branch.kind === 'local')!;
    const remote = refs.branches.find((branch) => branch.kind === 'remote')!;
    const tag = refs.tags[0]!;
    const shared = {
      ...refs,
      branches: refs.branches.map((branch) =>
        branch.id === remote.id ? { ...branch, tip: local.tip } : branch,
      ),
      tags: refs.tags.map((candidate) =>
        candidate.id === tag.id ? { ...candidate, target: local.tip } : candidate,
      ),
    };

    expect(terminalInsertOptionsAt(shared, local.tip)).toEqual([
      { key: local.id, kind: 'localBranch', value: local.name },
      { key: remote.id, kind: 'remoteBranch', value: remote.name },
      { key: tag.id, kind: 'tag', value: tag.name },
      { key: `sha:${local.tip}`, kind: 'sha', value: local.tip.slice(0, 7) },
    ]);
  });

  it('usa los tres tonos de interfaz aunque la consola tenga una paleta distinta', () => {
    const palette = terminalGraphPalette({
      '--text-success': 'green',
      '--text-info': 'blue',
      '--text-secondary': 'gray',
      '--text-primary': 'dark-ink',
      '--surface-panel': 'light-panel',
      '--terminal-prompt': 'bright-green',
      '--terminal-info': 'bright-blue',
      '--terminal-muted': 'light-gray',
      '--terminal-foreground': 'white',
      '--terminal-bg': '#111111',
      '--font-family-code': 'mono',
    });

    expect(new Set(palette.branches.map((branch) => branch.color))).toEqual(
      new Set(['green', 'blue', 'gray']),
    );
    expect(new Set(palette.branches.map((branch) => branch.dash.join(','))).size).toBeGreaterThan(
      1,
    );
    expect(new Set(palette.branches.map((branch) => branch.shape)).size).toBeGreaterThan(1);
    expect(palette.wip).toBe('gray');
    expect(palette.stash).toBe('blue');
    expect(palette.wipNode).toBe('dark-ink');
    expect(palette.avatarInk).toBe('light-panel');
    expect(palette.avatarFont).toBe('mono');
  });
});

describe('filas compartidas del grafo de Terminal', () => {
  it('prepara y filtra por bloques con los mismos índices y contexto que la versión síncrona', async () => {
    const { history, refs, status } = buildLargeRepo({ commitCount: 1_000, branchCount: 8 });
    const entries = await buildTerminalGraphEntriesAsync(history.commits, refs);
    const rows = buildCommitRows(history.commits, status, refs.stashes);
    for (const filter of ['', 'main', 'WIP', history.commits[5]!.sha, 'ninguna-coincidencia']) {
      expect(await terminalGraphRowsAsync(rows, entries, filter)).toEqual(
        terminalGraphRows(rows, entries, filter),
      );
    }
  });
  it('mantiene commits intermedios e índices originales entre coincidencias', async () => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const [refs, page, status] = await Promise.all([
      git.readRefs('gitthul'),
      git.readCommits('gitthul', { limit: 3 }),
      git.readStatus('gitthul'),
    ]);
    const commits = page.commits.map((commit, index) => ({
      ...commit,
      summary: index === 1 ? 'contexto' : 'coincidencia',
    }));
    const rows = buildCommitRows(commits, { ...status, clean: false }, []);
    const entries = buildTerminalGraphEntries(commits, refs, '');
    const visible = terminalGraphRows(rows, entries, 'coincidencia');
    expect(visible.map(({ graphIndex }) => graphIndex)).toEqual([1, 2, 3]);
    expect(visible[1]?.entry?.commit.summary).toBe('contexto');
    const layout = buildGraph(rows, refs);
    expect(layout.nodeAt(0).kind).toBe('wip');
    expect(visible.every(({ graphIndex }) => layout.nodeAt(graphIndex).kind === 'commit')).toBe(
      true,
    );
  });

  it('conserva WIP, stashes y geometría del principal al buscar', async () => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const [refs, page, status] = await Promise.all([
      git.readRefs('gitthul'),
      git.readCommits('gitthul', { limit: 100 }),
      git.readStatus('gitthul'),
    ]);
    const rows = buildCommitRows(page.commits, { ...status, clean: false }, refs.stashes);
    const entries = buildTerminalGraphEntries(page.commits, refs, '');
    const all = terminalGraphRows(rows, entries, '');
    expect(all.map(({ row }) => row)).toEqual(rows);
    expect(all[0]?.row.kind).toBe('wip');
    expect(all.some(({ row }) => row.kind === 'stash')).toBe(true);
    const matches = terminalGraphRows(rows, entries, 'a');
    for (let index = 1; index < matches.length; index++) {
      expect(matches[index]!.graphIndex).toBe(matches[index - 1]!.graphIndex + 1);
    }
    expect(terminalGraphRows(rows, entries, 'WIP')[0]?.graphIndex).toBe(0);
    expect(terminalGraphRows(rows, entries, 'no-such-reference')).toEqual([]);
    const clean = buildCommitRows(page.commits, { ...status, clean: true }, refs.stashes);
    expect(terminalGraphRows(clean, entries, '').some(({ row }) => row.kind === 'wip')).toBe(false);
  });
});

describe('comandos de commit para Terminal', () => {
  it('usa SHA completo y propone una rama nueva sin colisiones', async () => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const [refs, page] = await Promise.all([
      git.readRefs('gitthul'),
      git.readCommits('gitthul', { limit: 1 }),
    ]);
    const commit = page.commits[0]!;
    const commands = terminalCommitCommands(commit, {
      ...refs,
      branches: [
        ...refs.branches,
        { ...refs.branches[0]!, name: `branch-${commit.sha.slice(0, 7)}` },
      ],
    });
    expect(commands.show).toBe(`git show ${commit.sha} --`);
    expect(commands.branch).toBe(`git branch branch-${commit.sha.slice(0, 7)}-2 ${commit.sha}`);
    expect(commands.compare('HEAD')).toBe(`git diff ${commit.sha} HEAD --`);
    expect(commands.cherryPick).toBe(`git cherry-pick ${commit.sha}`);
    expect(terminalShellArgument("topic/it's-ok")).toBe("'topic/it'\"'\"'s-ok'");
    expect(commands.compare('topic/$(echo bad)')).toBe(
      `git diff ${commit.sha} 'topic/$(echo bad)' --`,
    );
  });
});
