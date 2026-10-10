import { useMemo, useRef, useState, type MouseEvent } from 'react';

import type { Commit } from '@core/domain/commit';
import type { WorkingStatus } from '@core/domain/status';
import { buildCommitRows } from '@features/working/commits';
import type { RefsSnapshot, Stash } from '@core/domain/refs';
import { useCssTokens } from '@design/useCssTokens';
import { CommitGraph, type GraphColumn } from '@features/working/CommitGraph';
import { RefIcon } from '@features/working/RefIcon';
import { buildGraph } from '@features/working/graph';
import { graphEdgePadding, resolveGraphMetrics } from '@features/working/graphPaint';
import { useI18n } from '@i18n/useI18n';
import { Menu } from '@ui/Menu';
import { SearchInput } from '@ui/SearchInput';
import { VirtualList } from '@ui/VirtualList';
import type { MenuEntry } from '@ui/menu';

import styles from './TerminalRefSidebar.module.css';
import {
  buildTerminalGraphEntries,
  terminalGraphPalette,
  terminalCommitCommands,
  terminalShellArgument,
  terminalGraphRows,
  type TerminalGraphEntry,
  type TerminalInsertOption,
} from './terminalGraph';

interface TerminalRefSidebarProps {
  refs: RefsSnapshot | null;
  commits: readonly Commit[];
  status: WorkingStatus | null;
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
  refs,
  commits,
  status,
  onLoadMore,
  onInsert,
}: TerminalRefSidebarProps) {
  const { t } = useI18n();
  const [graphScroll, setGraphScroll] = useState(0);
  const [filter, setFilter] = useState('');
  const [openMenu, setOpenMenu] = useState<OpenInsertMenu | null>(null);
  const rowAnchors = useRef(new Map<string, HTMLElement>());
  const tokens = useCssTokens(TERMINAL_GRAPH_TOKENS);

  const entries = useMemo(
    () => (refs ? buildTerminalGraphEntries(commits, refs, '') : []),
    [commits, refs],
  );
  const rows = useMemo(
    () => (refs && status ? buildCommitRows(commits, status, refs.stashes) : []),
    [commits, refs, status],
  );
  const visibleRows = useMemo(
    () => terminalGraphRows(rows, entries, filter),
    [rows, entries, filter],
  );
  const layout = useMemo(() => (refs ? buildGraph(rows, refs) : null), [refs, rows]);
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

  const graphCell = (graphIndex: number, author: string) =>
    graph && (
      <span className={styles.graph} style={{ width: `min(${graph.width}px, 40%)` }}>
        <span
          className={styles.graphContent}
          style={{ transform: `translateX(${-graphScroll}px)` }}
        >
          <CommitGraph column={graph} row={graphIndex} author={author} />
        </span>
      </span>
    );

  const renderRow = (item: (typeof visibleRows)[number]) => {
    const { row, entry, graphIndex } = item;
    if (row.kind !== 'commit') {
      const activate = (anchor: HTMLElement | null) => {
        if (row.kind === 'wip') onInsert('git status');
        else if (anchor) setOpenMenu({ kind: 'stash', stash: row.stash, anchor });
      };
      return (
        <div
          className={styles.row}
          ref={(node) => {
            if (node) rowAnchors.current.set(row.key, node);
            else rowAnchors.current.delete(row.key);
          }}
          role="button"
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
          <span className={styles.details}>
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
          </span>
        </div>
      );
    }
    if (!entry) return null;
    const branches = entry.insertOptions.filter(
      (option) => option.kind === 'localBranch' || option.kind === 'remoteBranch',
    );
    const tags = entry.insertOptions.filter((option) => option.kind === 'tag');
    return (
      <div
        ref={(node) => {
          if (node) rowAnchors.current.set(entry.key, node);
          else rowAnchors.current.delete(entry.key);
        }}
        className={styles.row}
        role="button"
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
        <span className={styles.details}>
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
        </span>
      </div>
    );
  };

  return (
    <div className={styles.sidebar}>
      <SearchInput
        label={t('view.terminal.railFilter')}
        value={filter}
        onChange={setFilter}
        clearLabel={t('view.terminal.railFilter')}
        placeholder={t('view.terminal.railFilter')}
      />
      {graph && (
        <div
          className={styles.graphScroll}
          style={{ width: `min(${graph.width}px, 40%)` }}
          role="region"
          aria-label={t('view.terminal.graphScroll')}
          tabIndex={0}
          onScroll={(event) => setGraphScroll(event.currentTarget.scrollLeft)}
        >
          <div style={{ width: graph.width, height: 1 }} />
        </div>
      )}
      <div className={styles.list}>
        <VirtualList
          items={visibleRows}
          className={styles.listViewport}
          onRangeChange={(range) => {
            if (filter.trim() === '' && range.endIndex >= rows.length - 20) onLoadMore();
          }}
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
          empty={<div className={styles.empty}>{refs ? t('view.terminal.railFilter') : '—'}</div>}
        />
      </div>
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
