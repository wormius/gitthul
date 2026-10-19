import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { useAsyncData } from '@app/useAsyncData';

import type { Commit } from '@core/domain/commit';
import type { WorkingStatus } from '@core/domain/status';
import type { GitOperationError } from '@core/domain/errors';
import { buildCommitRows } from '@features/working/commits';
import type { RefsSnapshot, Stash } from '@core/domain/refs';
import { useCssTokens } from '@design/useCssTokens';
import { CommitGraph, type GraphColumn } from '@features/working/CommitGraph';
import { RefIcon } from '@features/working/RefIcon';
import { buildGraphAsync } from '@features/working/graph';
import { graphEdgePadding, resolveGraphMetrics } from '@features/working/graphPaint';
import { useI18n } from '@i18n/useI18n';
import { DataGrid } from '@ui/DataGrid';
import { DataGridCell } from '@ui/DataGridCell';
import { DataGridRow } from '@ui/DataGridRow';
import type { DataGridColumn } from '@ui/dataGridUtils';
import { Menu } from '@ui/Menu';
import { ProgressBar } from '@ui/ProgressBar';
import { SearchInput } from '@ui/SearchInput';
import { VirtualList, type VirtualRowContext } from '@ui/VirtualList';
import type { MenuEntry } from '@ui/menuUtils';

import styles from './TerminalRefSidebar.module.css';
import {
  buildTerminalGraphEntriesAsync,
  terminalGraphPalette,
  terminalCommitCommands,
  terminalShellArgument,
  terminalGraphRowsAsync,
  type TerminalGraphEntry,
  type TerminalInsertOption,
} from './terminalGraph';

interface TerminalRefSidebarProps {
  repoId: string | null;
  refs: RefsSnapshot | null;
  commits: readonly Commit[];
  status: WorkingStatus | null;
  loading: boolean;
  loadingMore: boolean;
  error: GitOperationError | null;
  onRetry: () => void;
  onLoadMore: () => void;
  onInsert: (text: string) => void;
}

const ROW_HEIGHT = 28;
const TERMINAL_GRAPH_TOKENS = [
  '--text-success',
  '--text-info',
  '--text-secondary',
  '--text-primary',
  '--surface-panel',
  '--font-family-code',
  '--graph-lane-width',
  '--graph-node-radius',
  '--graph-node-avatar',
  '--graph-line-width',
  '--graph-corner-radius',
] as const;

function BranchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 2v7.5a2.5 2.5 0 0 0 2.5 2.5H12M12 12V4M4 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM12 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2.5 8.4V3.5a1 1 0 0 1 1-1h4.9a1 1 0 0 1 .7.3l4.6 4.6a1 1 0 0 1 0 1.4L9.8 13.7a1 1 0 0 1-1.4 0L2.8 9.1a1 1 0 0 1-.3-.7Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" />
    </svg>
  );
}

function ShaIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 2v3M8 11v3M2 8h3M11 8h3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WipIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="m3 10 7-7 3 3-7 7-4 1 1-4ZM9 4l3 3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type OpenInsertMenu =
  | { kind: 'commit'; entry: TerminalGraphEntry; anchor: HTMLElement }
  | { kind: 'stash'; stash: Stash; anchor: HTMLElement };

/**
 * El rail lateral de la terminal: grafo compacto del historial con ramas, tags
 * y SHAs insertables. Conserva el motor del grafo real, pero no la presentación
 * ni la paleta multicolor de GitWorking.
 */
export function TerminalRefSidebar({
  repoId,
  refs,
  commits,
  status,
  loading,
  loadingMore,
  error,
  onRetry,
  onLoadMore,
  onInsert,
}: TerminalRefSidebarProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [openMenu, setOpenMenu] = useState<OpenInsertMenu | null>(null);
  const rowAnchors = useRef(new Map<string, HTMLElement>());
  const requestedRange = useRef<{
    commits: readonly Commit[];
    rowCount: number;
    endIndex: number;
  } | null>(null);
  const tokens = useCssTokens(TERMINAL_GRAPH_TOKENS);

  const prepareGraph = useCallback(
    async ({ signal }: { signal?: AbortSignal }) => {
      if (!refs || !status) return null;
      const entries = await buildTerminalGraphEntriesAsync(commits, refs, signal);
      const rows = buildCommitRows(commits, status, refs.stashes);
      const layout = await buildGraphAsync(rows, refs, signal);
      const allRows = await terminalGraphRowsAsync(rows, entries, '', signal);
      return { entries, rows, layout, commits, refs, status, allRows };
    },
    [commits, refs, status],
  );
  const prepared = useAsyncData(prepareGraph, { resourceKey: repoId ?? '' });
  const data = prepared.status === 'ready' ? prepared.data : null;
  const preparing =
    prepared.status !== 'failed' &&
    refs !== null &&
    status !== null &&
    (data?.commits !== commits || data.refs !== refs || data.status !== status);
  const rows = data?.rows ?? [];
  const filterGraph = useCallback(
    async ({ signal }: { signal?: AbortSignal }) => {
      if (!data) return null;
      const rows =
        filter.trim() === ''
          ? data.allRows
          : await terminalGraphRowsAsync(data.rows, data.entries, filter, signal);
      return { rows, filter, graph: data };
    },
    [data, filter],
  );
  const filtered = useAsyncData(filterGraph, { resourceKey: repoId ?? '' });
  const matches = filtered.status === 'ready' ? filtered.data : null;
  const filtering =
    filtered.status !== 'failed' &&
    data !== null &&
    (matches?.filter !== filter || matches.graph !== data);
  const visibleRows = matches?.rows ?? data?.allRows ?? [];
  const layout = matches?.graph.layout ?? data?.layout ?? null;
  const graphError =
    error ??
    (prepared.status === 'failed'
      ? prepared.error
      : filtered.status === 'failed'
        ? filtered.error
        : null);
  const handleRange = useCallback(
    ({ endIndex }: { endIndex: number }) => {
      if (!data || loading || preparing || filtering || filter.trim() !== '') return;
      if (endIndex < rows.length - 20) {
        requestedRange.current = null;
        return;
      }
      // Un fallo no debe pedir la misma página otra vez por cada render.
      if (
        requestedRange.current?.commits === data.commits &&
        requestedRange.current.rowCount === rows.length &&
        requestedRange.current.endIndex === endIndex
      )
        return;
      requestedRange.current = { commits: data.commits, rowCount: rows.length, endIndex };
      onLoadMore();
    },
    [data, filter, filtering, loading, onLoadMore, preparing, rows.length],
  );
  const palette = useMemo(() => terminalGraphPalette(tokens), [tokens]);
  const metrics = useMemo(() => resolveGraphMetrics(tokens, ROW_HEIGHT), [tokens]);
  const graph = useMemo<GraphColumn | null>(() => {
    if (!layout) return null;

    return {
      layout,
      palette,
      metrics,
      width: Math.max(layout.laneCount, 1) * metrics.laneWidth + graphEdgePadding(metrics) * 2,
      form: 'ring',
    };
  }, [layout, metrics, palette]);
  const columns = useMemo<readonly DataGridColumn[]>(() => {
    const graphLabel = t('working.commitTable.column.graph');
    const messageLabel = t('working.commitTable.column.subject');
    return [
      { key: 'graph', header: graphLabel, name: graphLabel, width: 96, minWidth: 72 },
      {
        key: 'message',
        header: messageLabel,
        name: messageLabel,
        width: 240,
        minWidth: 80,
        grow: true,
      },
    ];
  }, [t]);

  const chooseEntry = (entry: TerminalGraphEntry, anchor: HTMLElement | null) => {
    if (anchor) setOpenMenu({ kind: 'commit', entry, anchor });
  };

  const closeMenu = () => {
    const anchor = openMenu?.anchor;

    setOpenMenu(null);
    anchor?.focus({ preventScroll: true });
  };

  const optionLabel = (option: TerminalInsertOption): string => {
    switch (option.kind) {
      case 'localBranch':
        return t('view.terminal.transcribe', {
          value: t('working.refLabel.local', { name: option.value }),
        });
      case 'remoteBranch':
        return t('view.terminal.transcribe', {
          value: t('working.refLabel.remote', { name: option.value }),
        });
      case 'tag':
        return t('view.terminal.transcribe', {
          value: t('working.refLabel.tag', { name: option.value }),
        });
      case 'sha':
        return t('view.terminal.transcribe', { value: `SHA ${option.value}` });
    }
  };

  const optionIcon = (option: TerminalInsertOption) => (
    <span className={styles.menuIcon} aria-hidden="true">
      {option.kind === 'tag' ? <TagIcon /> : option.kind === 'sha' ? <ShaIcon /> : <BranchIcon />}
    </span>
  );

  const menuItems: readonly MenuEntry[] = (() => {
    if (!openMenu || !refs) return [];
    if (openMenu.kind === 'stash') {
      const stash = openMenu.stash;
      const selector = `'stash@{${stash.index}}'`;
      return [
        {
          key: 'sha',
          label: t('view.terminal.transcribe', { value: `SHA ${stash.sha.slice(0, 7)}` }),
          description: stash.sha,
          onSelect: () => onInsert(terminalShellArgument(stash.sha)),
        },
        ...(['pop', 'apply'] as const).map((operation) => ({
          key: operation,
          label: t('view.terminal.transcribe', { value: `git stash ${operation}` }),
          description: `git stash ${operation} ${selector}`,
          onSelect: () => onInsert(`git stash ${operation} ${selector}`),
        })),
      ];
    }
    const commands = terminalCommitCommands(openMenu.entry.commit, refs);
    const action = (
      key: 'show' | 'log' | 'branch' | 'compareOther' | 'checkout' | 'cherryPick' | 'revert',
      command: string,
    ): MenuEntry => ({
      key,
      label: t(`view.terminal.command.${key}`),
      description: command,
      onSelect: () => onInsert(command),
    });
    return [
      ...openMenu.entry.insertOptions.map((option) => ({
        key: option.key,
        label: optionLabel(option),
        icon: optionIcon(option),
        onSelect: () => onInsert(terminalShellArgument(option.value)),
      })),
      { kind: 'separator', key: 'commands' },
      action('show', commands.show),
      action('log', commands.log),
      action('branch', commands.branch),
      {
        kind: 'submenu',
        key: 'compare',
        label: t('view.terminal.command.compare'),
        items: [
          ...['HEAD', ...new Set(refs.branches.map((branch) => branch.name))].map((target) => ({
            key: target,
            label: target,
            description: commands.compare(target),
            onSelect: () => onInsert(commands.compare(target)),
          })),
          action('compareOther', commands.compareOther),
        ],
      },
      action('checkout', commands.checkout),
      action('cherryPick', commands.cherryPick),
      action('revert', commands.revert),
    ];
  })();

  const graphCell = (graphIndex: number, author: string) => (
    <DataGridCell columnKey="graph" className={styles.graph}>
      {graph && (
        <span className={styles.graphContent}>
          <CommitGraph column={graph} row={graphIndex} author={author} />
        </span>
      )}
    </DataGridCell>
  );

  const renderRow = (item: (typeof visibleRows)[number], context: VirtualRowContext) => {
    const { row, entry, graphIndex } = item;
    if (row.kind !== 'commit') {
      const activate = (anchor: HTMLElement | null) => {
        if (row.kind === 'wip') onInsert('git status');
        else if (anchor) setOpenMenu({ kind: 'stash', stash: row.stash, anchor });
      };
      return (
        <DataGridRow
          index={context.index}
          className={styles.row}
          ref={(node) => {
            if (node) rowAnchors.current.set(row.key, node);
            else rowAnchors.current.delete(row.key);
          }}
          tabIndex={0}
          onClick={(event) => activate(event.currentTarget)}
          onContextMenu={(event) => {
            event.preventDefault();
            activate(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.stopPropagation();
              activate(event.currentTarget);
            }
          }}
        >
          {graphCell(graphIndex, '')}
          <DataGridCell columnKey="message" className={styles.details}>
            <span
              className={styles.typeIcon}
              role="img"
              aria-label={row.kind === 'wip' ? 'WIP' : 'Stash'}
              title={row.kind === 'wip' ? t('working.commitTable.wip') : 'Stash'}
            >
              {row.kind === 'wip' ? <WipIcon /> : <RefIcon kind="stash" />}
            </span>
            {row.kind === 'wip' ? (
              <>
                <span className={styles.summary}>{row.label ?? 'WIP'}</span>
                <span className={styles.count}>{row.fileCount}</span>
              </>
            ) : (
              <span className={styles.summary}>{row.stash.message}</span>
            )}
          </DataGridCell>
        </DataGridRow>
      );
    }
    if (!entry) return null;
    const branches = entry.insertOptions.filter(
      (option) => option.kind === 'localBranch' || option.kind === 'remoteBranch',
    );
    const tags = entry.insertOptions.filter((option) => option.kind === 'tag');
    return (
      <DataGridRow
        index={context.index}
        ref={(node) => {
          if (node) rowAnchors.current.set(entry.key, node);
          else rowAnchors.current.delete(entry.key);
        }}
        className={styles.row}
        tabIndex={0}
        onClick={(event: MouseEvent<HTMLDivElement>) => {
          chooseEntry(entry, event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;

          event.preventDefault();
          event.stopPropagation();
          chooseEntry(entry, event.currentTarget);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          chooseEntry(entry, event.currentTarget);
        }}
        title={`${entry.insertOptions.map((option) => option.value).join(', ')} — ${entry.commit.summary}`}
      >
        {graphCell(graphIndex, entry.commit.author.name)}
        <DataGridCell columnKey="message" className={styles.details}>
          <span className={styles.typeIcon} role="img" aria-label="Commit" title="Commit">
            <ShaIcon />
          </span>
          {tags.length > 0 && (
            <span
              className={styles.typeIcon}
              role="img"
              aria-label={t('working.refLabel.tag', {
                name: tags.map((tag) => tag.value).join(', '),
              })}
              title={tags.map((tag) => tag.value).join(', ')}
            >
              <TagIcon />
            </span>
          )}
          {branches.length > 0 && (
            <span
              className={styles.branch}
              title={branches.map((branch) => branch.value).join(', ')}
              aria-label={t('view.terminal.branchCount', { count: branches.length })}
            >
              <span className={styles.icon} aria-hidden="true">
                <BranchIcon />
              </span>
              <span>{branches.length}</span>
            </span>
          )}
          <span className={styles.summary}>{entry.commit.summary}</span>
        </DataGridCell>
      </DataGridRow>
    );
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.filter}>
        <SearchInput
          label={t('view.terminal.railFilter')}
          value={filter}
          onChange={setFilter}
          clearLabel={t('view.terminal.railFilter')}
          placeholder={t('view.terminal.railFilter')}
        />
        {(loading || loadingMore || preparing || filtering) && (
          <ProgressBar
            className={styles.progress}
            label={t(
              loadingMore ? 'working.commitTable.loadingMore' : 'working.commitTable.loading',
            )}
          />
        )}
      </div>
      {graphError && (
        <GitErrorPanel
          error={graphError}
          fixes={{
            retry: () => {
              requestedRange.current = null;
              onRetry();
              prepared.reload();
              filtered.reload();
            },
          }}
        />
      )}
      <DataGrid
        className={styles.historyGrid}
        columns={columns}
        label={t('view.terminal.railLabel')}
        rowCount={visibleRows.length}
        storageId="terminal.references"
      >
        <VirtualList
          className={styles.historyScroll}
          items={visibleRows}
          semantics="rowgroup"
          onRangeChange={handleRange}
          getKey={({ row }) => row.key}
          renderRow={renderRow}
          label={t('view.terminal.railLabel')}
          rowHeight={ROW_HEIGHT}
          onActivate={({ row, entry }) => {
            if (entry) chooseEntry(entry, rowAnchors.current.get(entry.key) ?? null);
            else if (row.kind === 'wip') onInsert('git status');
            else if (row.kind === 'stash') {
              const anchor = rowAnchors.current.get(row.key);
              if (anchor) setOpenMenu({ kind: 'stash', stash: row.stash, anchor });
            }
          }}
          empty={
            loading || preparing || error ? undefined : (
              <div className={styles.empty}>{refs ? t('view.terminal.railFilter') : '—'}</div>
            )
          }
        />
      </DataGrid>
      {openMenu && (
        <Menu
          items={menuItems}
          label={t('view.terminal.railLabel')}
          description={t('view.terminal.refInsertOptions')}
          anchor={openMenu.anchor}
          side="left"
          align="start"
          trigger={openMenu.anchor}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
