import type { Commit } from '@core/domain/commit';
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
  const normalizedFilter = filter.trim().toLocaleLowerCase();

  return commits.flatMap((commit) => {
    const labels = refLabelsAt(refs, commit.sha);
    const insertOptions = terminalInsertOptionsAt(refs, commit.sha);
    const searchable = [
      commit.sha,
      commit.summary,
      ...labels.flatMap((label) => [label.name, label.refName]),
    ]
      .join('\n')
      .toLocaleLowerCase();

    if (normalizedFilter !== '' && !searchable.includes(normalizedFilter)) return [];

    return [{ key: commit.sha, commit, labels, insertOptions }];
  });
}

/**
 * Paleta deliberadamente corta: éxito, información y tinta secundaria de la
 * interfaz. El grafo sigue el modo claro/oscuro del panel lateral. Las formas
 * y patrones se alternan para que una
 * calle no dependa únicamente del color y para evitar copiar el arcoíris de
 * GitWorking.
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
      { color: success, dash: [5, 3], shape: 'ring-filled' },
      { color: info, dash: [2, 3], shape: 'diamond' },
      { color: secondary, dash: [7, 3], shape: 'square' },
      { color: success, dash: [2, 3], shape: 'diamond' },
      { color: info, dash: [7, 3], shape: 'square' },
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
): readonly { row: CommitTableRow; graphIndex: number; entry?: TerminalGraphEntry }[] {
  const bySha = new Map(entries.map((entry) => [entry.key, entry]));
  const all = rows.map((row, graphIndex) => ({
    row,
    graphIndex,
    entry: row.kind === 'commit' ? bySha.get(row.key) : undefined,
  }));
  const query = filter.trim().toLocaleLowerCase();
  if (!query) return all;
  const matches = all.flatMap(({ row, entry }, index) => {
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
    return text.toLocaleLowerCase().includes(query) ? [index] : [];
  });
  const first = matches[0];
  const last = matches[matches.length - 1];
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
