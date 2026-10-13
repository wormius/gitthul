import type { Commit } from '@core/domain/commit';
import { runCooperatively } from '@app/runCooperatively';
import type { CommitTableRow } from '@features/working/commits';
import type { RefsSnapshot } from '@core/domain/refs';
import type { GraphPalette } from '@features/working/graphPaint';
import { refLabelsAt, type RefLabelItem } from '@features/working/refs';

export interface TerminalGraphEntry {
  key: string;
  commit: Commit;
  labels: readonly RefLabelItem[];
  insertOptions: readonly TerminalInsertOption[];
}

export interface TerminalInsertOption {
  key: string;
  kind: 'localBranch' | 'remoteBranch' | 'tag' | 'sha';
  value: string;
}

/** Todas las identidades inequívocas que Git acepta para un mismo commit. */
export function terminalInsertOptionsAt(
  refs: RefsSnapshot,
  sha: string,
): readonly TerminalInsertOption[] {
  return [
    ...refs.branches
      .filter((branch) => branch.tip === sha && branch.kind === 'local')
      .map((branch) => ({
        key: branch.id,
        kind: 'localBranch' as const,
        value: branch.name,
      })),
    ...refs.branches
      .filter((branch) => branch.tip === sha && branch.kind === 'remote')
      .map((branch) => ({
        key: branch.id,
        kind: 'remoteBranch' as const,
        value: branch.name,
      })),
    ...refs.tags
      .filter((tag) => tag.target === sha)
      .map((tag) => ({ key: tag.id, kind: 'tag' as const, value: tag.name })),
    { key: `sha:${sha}`, kind: 'sha' as const, value: sha.slice(0, 7) },
  ];
}

/**
 * El historial compacto que acompaña a la Terminal.
 *
 * La etiqueta visual puede agrupar local y upstream, pero `insertOptions`
 * conserva cada identidad por separado. El filtro incluye mensaje, SHA y
 * nombres reales para que una rama remota siga siendo localizable aunque
 * enseñe su nombre corto.
 */
export function buildTerminalGraphEntries(
  commits: readonly Commit[],
  refs: RefsSnapshot,
  filter: string,
): readonly TerminalGraphEntry[] {
  const steps = terminalEntrySteps(commits, refs, filter);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

export function buildTerminalGraphEntriesAsync(
  commits: readonly Commit[],
  refs: RefsSnapshot,
  signal?: AbortSignal,
): Promise<readonly TerminalGraphEntry[]> {
  return runCooperatively(terminalEntrySteps(commits, refs, ''), signal);
}

function* terminalEntrySteps(
  commits: readonly Commit[],
  refs: RefsSnapshot,
  filter: string,
): Generator<void, readonly TerminalGraphEntry[]> {
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  // Indexar una vez evita recorrer todas las referencias por cada commit.
  const bySha = new Map<string, RefsSnapshot>();
  const groupAt = (sha: string) => {
    let group = bySha.get(sha);
    if (!group) {
      group = { ...refs, branches: [], tags: [] };
      bySha.set(sha, group);
    }
    return group;
  };
  const branchesBySha = new Map<string, RefsSnapshot['branches'][number][]>();
  const tagsBySha = new Map<string, RefsSnapshot['tags'][number][]>();
  for (const [index, branch] of refs.branches.entries()) {
    if (index % 256 === 0) yield;
    const branches = branchesBySha.get(branch.tip) ?? [];
    branches.push(branch);
    branchesBySha.set(branch.tip, branches);
    groupAt(branch.tip).branches = branches;
  }
  for (const [index, tag] of refs.tags.entries()) {
    if (index % 256 === 0) yield;
    const tags = tagsBySha.get(tag.target) ?? [];
    tags.push(tag);
    tagsBySha.set(tag.target, tags);
    groupAt(tag.target).tags = tags;
  }
  const emptyRefs: RefsSnapshot = { ...refs, branches: [], tags: [] };
  const entries: TerminalGraphEntry[] = [];
  for (const [index, commit] of commits.entries()) {
    if (index % 256 === 0) yield;
    const group = bySha.get(commit.sha) ?? emptyRefs;
    const labels = refLabelsAt(group, commit.sha);
    const insertOptions = terminalInsertOptionsAt(group, commit.sha);
    if (normalizedFilter !== '') {
      const searchable = [
        commit.sha,
        commit.summary,
        ...labels.flatMap((label) => [label.name, label.refName]),
      ]
        .join('\n')
        .toLocaleLowerCase();

      if (!searchable.includes(normalizedFilter)) continue;
    }
    entries.push({ key: commit.sha, commit, labels, insertOptions });
  }
  return entries;
}

/**
 * Paleta deliberadamente corta: éxito, información y tinta secundaria de la
 * interfaz. El grafo sigue el modo claro/oscuro del panel lateral. Los patrones
 * de línea distinguen las ramas sin depender únicamente del color. Todos los
 * commits son anillos; las formas sólidas identifican WIP y stashes en el
 * dibujante compartido.
 */
export function terminalGraphPalette(tokens: Record<string, string>): GraphPalette {
  const success = tokens['--text-success'] || tokens['--text-primary'] || 'currentColor';
  const info = tokens['--text-info'] || success;
  const secondary = tokens['--text-secondary'] || success;

  return {
    branches: [
      { color: success, dash: [], shape: 'ring' },
      { color: info, dash: [], shape: 'ring' },
      { color: secondary, dash: [], shape: 'ring' },
      { color: success, dash: [5, 3], shape: 'ring' },
      { color: info, dash: [2, 3], shape: 'ring' },
      { color: secondary, dash: [7, 3], shape: 'ring' },
      { color: success, dash: [2, 3], shape: 'ring' },
      { color: info, dash: [7, 3], shape: 'ring' },
    ],
    wip: secondary,
    stash: info,
    wipNode: tokens['--text-primary'] || secondary,
    avatarInk: tokens['--surface-panel'] || tokens['--surface-sunken'] || secondary,
    avatarFont: tokens['--font-family-code'] || 'monospace',
  };
}

/** Conserva las filas intermedias para no unir commits que no son adyacentes. */
export function terminalGraphRows(
  rows: readonly CommitTableRow[],
  entries: readonly TerminalGraphEntry[],
  filter: string,
): readonly TerminalGraphRow[] {
  const steps = terminalRowSteps(rows, entries, filter);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

export interface TerminalGraphRow {
  row: CommitTableRow;
  graphIndex: number;
  entry?: TerminalGraphEntry;
}

export function terminalGraphRowsAsync(
  rows: readonly CommitTableRow[],
  entries: readonly TerminalGraphEntry[],
  filter: string,
  signal?: AbortSignal,
): Promise<readonly TerminalGraphRow[]> {
  return runCooperatively(terminalRowSteps(rows, entries, filter), signal);
}

function* terminalRowSteps(
  rows: readonly CommitTableRow[],
  entries: readonly TerminalGraphEntry[],
  filter: string,
): Generator<void, readonly TerminalGraphRow[]> {
  const bySha = new Map<string, TerminalGraphEntry>();
  for (const [index, entry] of entries.entries()) {
    if (index % 256 === 0) yield;
    bySha.set(entry.key, entry);
  }
  const all: TerminalGraphRow[] = [];
  for (const [graphIndex, row] of rows.entries()) {
    if (graphIndex % 256 === 0) yield;
    all.push({ row, graphIndex, entry: row.kind === 'commit' ? bySha.get(row.key) : undefined });
  }
  const query = filter.trim().toLocaleLowerCase();
  if (!query) return all;
  let first: number | undefined;
  let last: number | undefined;
  for (const [index, { row, entry }] of all.entries()) {
    if (index % 256 === 0) yield;
    const text =
      row.kind === 'wip'
        ? (row.label ?? 'WIP')
        : row.kind === 'stash'
          ? `${row.stash.message} stash@{${row.stash.index}} ${row.stash.sha}`
          : [
              row.commit.sha,
              row.commit.summary,
              ...(entry?.insertOptions.map((option) => option.value) ?? []),
            ].join('\n');
    if (text.toLocaleLowerCase().includes(query)) {
      first ??= index;
      last = index;
    }
  }
  return first === undefined || last === undefined ? [] : all.slice(first, last + 1);
}

/** Cita argumentos para el shell POSIX sin interpretar nombres como comandos. */
export function terminalShellArgument(value: string): string {
  return /^[a-zA-Z0-9_./:@{}+-]+$/.test(value)
    ? value
    : "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function terminalCommitCommands(commit: Commit, refs: RefsSnapshot) {
  const sha = terminalShellArgument(commit.sha);
  let name = `branch-${commit.sha.slice(0, 7)}`;
  let suffix = 2;
  while (refs.branches.some((branch) => branch.name === name)) {
    name = `branch-${commit.sha.slice(0, 7)}-${suffix++}`;
  }
  return {
    show: `git show ${sha} --`,
    log: `git log -1 --format=fuller ${sha} --`,
    branch: `git branch ${name} ${sha}`,
    compare: (target: string) => `git diff ${sha} ${terminalShellArgument(target)} --`,
    compareOther: `git diff ${sha} `,
    checkout: `git switch --detach ${sha}`,
    cherryPick: `git cherry-pick ${sha}`,
    revert: `git revert ${sha}`,
  };
}
