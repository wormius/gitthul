import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import type { Commit, Sha } from '@core/domain/commit';
import { shortSha } from '@core/domain/commit';
import { stashName, type Branch, type RefsSnapshot, type Stash } from '@core/domain/refs';
import type { RepoId } from '@core/domain/repository';
import type { WorkingStatus } from '@core/domain/status';
import { useCssTokens } from '@design/useCssTokens';
import { useTheme } from '@design/useTheme';
import { useI18n } from '@i18n/useI18n';
import { DataGrid } from '@ui/DataGrid';
import type { DataGridColumn } from '@ui/dataGrid';
import { EmptyState } from '@ui/EmptyState';
import { Skeleton } from '@ui/Skeleton';
import { Spinner } from '@ui/Spinner';
import { VirtualList, type VirtualListHandle } from '@ui/VirtualList';

import { graphEdgePadding } from './graphPaint';
import { type GraphColumn } from './CommitGraph';
import { buildCommitRows, type CommitTableRow } from './commits';
import { CommitRow, type RowMenu } from './CommitRow';
import styles from './CommitTable.module.css';
import {
  commitMenu,
  commitSelectionMenu,
  localBranchMenu,
  remoteBranchMenu,
  stashMenu,
  tableHeaderExtras,
  tagMenu,
  type CompareSide,
  type MenuBuildContext,
} from './contextMenus';
import { buildGraph } from './graph';
import {
  graphNodeForm,
  GRAPH_TOKENS,
  resolveGraphMetrics,
  resolveGraphPalette,
} from './graphPaint';
import { integrationOffer, type DragRef } from './integration';
import { refLabelsAt, type RefLabelItem } from './refs';
import { commitRowHeight } from './rowHeight';
import { useCommitPages } from './useCommitPages';
import { useWorkingStore } from './workingStore';

interface CommitTableProps {
  repoId: RepoId;
  repoName: string;
  status: WorkingStatus;
  refs: RefsSnapshot;
  menuContext: MenuBuildContext;
  actions: {
    renameStash: (stash: Stash, message: string) => void;
    activateRemoteBranch: (remote: Branch, local?: Branch) => void;
  };
  onRenameWip: (name: string) => void;
  className?: string;
}

/** Cuántas filas antes del final del cargado disparan la página siguiente. */
const LOAD_MORE_THRESHOLD = 80;
const SKELETON_ROWS = 14;

/**
 * Hasta dónde se deja crecer la columna del grafo — sección 4.3 del subplan.
 *
 * Pasadas veinte calles la columna deja de ensancharse y estrena su scroll
 * horizontal propio, en vez de comerse la columna del mensaje, que es la que de
 * verdad se lee.
 */
const MAX_GRAPH_LANES = 20;

/** Identidad estable para los dos estados sin commits, y así no rehacer memos. */
const NO_COMMITS: readonly Commit[] = [];
const NO_LABELS: readonly RefLabelItem[] = [];
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function commitSelection(rows: readonly CommitTableRow[], selected: ReadonlySet<string>) {
  const indices: number[] = [];
  const shas: Sha[] = [];
  const points: CompareSide[] = [];

  rows.forEach((row, index) => {
    if (!selected.has(row.key)) return;

    if (row.kind === 'wip') {
      points.push({ kind: 'wip', label: row.label ?? 'WIP' });
      return;
    }

    if (row.kind === 'stash') {
      points.push({
        kind: 'revision',
        ref: row.stash.sha,
        label: stashName(row.stash),
      });
      return;
    }

    indices.push(index);
    shas.push(row.commit.sha);
    points.push({ kind: 'revision', ref: row.commit.sha, label: shortSha(row.commit.sha) });
  });

  const first = indices[0];
  const last = indices[indices.length - 1];
  const contiguous =
    first === undefined || last === undefined || last - first + 1 === indices.length;

  return { shas: shas.reverse(), points: points.reverse(), contiguous };
}

/**
 * La tabla de commits — CU-2 y CU-4.
 *
 * Sobre `DataGrid`: las seis columnas fijas de la sección 5 del subplan,
 * alimentadas por `useCommitPages`, con el nodo WIP y los guardados
 * intercalados por `buildCommitRows`, la columna Grafo pintada por
 * `CommitGraph`, las etiquetas de rama y tag de F2.4 y la selección simple y
 * múltiple sobre `selection.ts`, que es el mismo módulo que usan la lista y el
 * árbol de Repositorios.
 */
export function CommitTable({
  repoId,
  repoName,
  status,
  refs,
  menuContext,
  actions: tableActions,
  onRenameWip,
  className,
}: CommitTableProps) {
  const { t, locale } = useI18n();
  const { settings, resolved } = useTheme();
  const pages = useCommitPages(repoId);
  const tokens = useCssTokens(GRAPH_TOKENS);
  const listRef = useRef<VirtualListHandle>(null);
  const handledGoTo = useRef<number | null>(null);

  const selected = useWorkingStore((state) => state.selectedCommits);
  const setSelected = useWorkingStore((state) => state.setSelectedCommits);
  const nodeForm = useWorkingStore((state) => state.nodeForm);
  const goTo = useWorkingStore((state) => state.goTo);
  const historyVersion = useWorkingStore((state) => state.historyVersion);
  const openActionPreview = useWorkingStore((state) => state.openActionPreview);

  const rowHeightPx = commitRowHeight(settings.density, settings.uiFontSize);

  const commits = pages.state.status === 'ready' ? pages.state.commits : NO_COMMITS;
  const stashes = refs.stashes;
  const wipName = useWorkingStore((state) => state.wipName);

  // Las filas y el reparto de calles se calculan una vez por página cargada y
  // no una vez por pintado: recorrer cien mil commits en cada repintado de la
  // tabla —cambiar de selección, pasar el puntero— sería justo lo que la fase
  // del grafo tiene que evitar.
  const rows = useMemo(
    () => buildCommitRows(commits, status, stashes, wipName),
    [commits, status, stashes, wipName],
  );
  const layout = useMemo(() => buildGraph(rows, refs), [rows, refs]);

  const palette = useMemo(() => resolveGraphPalette(tokens), [tokens]);
  const metrics = useMemo(() => resolveGraphMetrics(tokens, rowHeightPx), [tokens, rowHeightPx]);

  // Las etiquetas se calculan por commit **con referencias** y no fila a fila:
  // en una historia de cien mil commits, apenas unas decenas llevan etiqueta, y
  // preguntar por cada fila costaría recorrer las referencias cien mil veces.
  const labelsBySha = useMemo(() => {
    const targets = new Set<Sha>();

    for (const branch of refs.branches) targets.add(branch.tip);
    for (const tag of refs.tags) targets.add(tag.target);

    return new Map([...targets].map((sha) => [sha, refLabelsAt(refs, sha)] as const));
  }, [refs]);

  // Mapa ligero nombre-de-referencia → color de grafo (1..8). Lo consumen los
  // chips del grafo (`RefLabel`) y los iconos del panel izquierdo (`RefRow`).
  const refColors = useMemo(() => {
    const shaToRow = new Map<Sha, number>();

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];

      if (row !== undefined && row.kind === 'commit') {
        shaToRow.set(row.commit.sha, index);
      }
    }

    const colors = new Map<string, number>();

    for (const branch of refs.branches) {
      const row = shaToRow.get(branch.tip);

      if (row !== undefined) {
        const color = layout.nodeAt(row).color;

        if (color > 0) colors.set(branch.name, color);
      }
    }

    for (const tag of refs.tags) {
      const row = shaToRow.get(tag.target);

      if (row !== undefined) {
        const color = layout.nodeAt(row).color;

        if (color > 0) colors.set(tag.name, color);
      }
    }

    return colors;
  }, [rows, refs, layout]);

  const setRefColors = useWorkingStore((state) => state.setRefColors);

  useEffect(() => {
    setRefColors(refColors);
  }, [refColors, setRefColors]);

  const handleReferenceDrop = useCallback(
    (source: DragRef, target: DragRef) => {
      const headBranch = refs.head.branch;

      if (headBranch === null || integrationOffer(source, target) === null) return;

      openActionPreview({ kind: 'merge', source, target, headBranch });
    },
    [openActionPreview, refs.head.branch],
  );

  const laneCount = Math.max(layout.laneCount, 1);
  const graphWidth = laneCount * metrics.laneWidth + graphEdgePadding(metrics) * 2;
  const graphColumnWidth =
    Math.min(laneCount, MAX_GRAPH_LANES) * metrics.laneWidth + graphEdgePadding(metrics) * 2;

  const graph = useMemo<GraphColumn>(
    () => ({
      layout,
      palette,
      metrics,
      width: graphWidth,
      // La regla de que el nodo-avatar no existe en «Contraste» vive en
      // `graphNodeForm` y no en el submenú: el menú se limita a no ofrecerlo, y
      // esto lo hace cumplir aunque la preferencia venga de otro sitio.
      form: graphNodeForm(nodeForm, resolved.theme),
    }),
    [graphWidth, layout, metrics, nodeForm, palette, resolved.theme],
  );

  const graphHeaderRef = useRef<HTMLSpanElement>(null);
  const [graphMinimum, setGraphMinimum] = useState(64);
  const graphLabel = t('working.commitTable.column.graph');
  const graphHeaderVisible = pages.state.status === 'ready' && rows.length > 0;
  useLayoutEffect(() => {
    const label = graphHeaderRef.current;
    if (!label) return;
    const measure = () => {
      if (!label.isConnected) return;
      const cell = label.closest('[role="columnheader"]') ?? label.parentElement;
      const style = cell ? getComputedStyle(cell) : null;
      setGraphMinimum(
        Math.ceil(
          label.getBoundingClientRect().width +
            parseFloat(style?.paddingLeft || '0') +
            parseFloat(style?.paddingRight || '0') +
            1,
        ),
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(label);
    void document.fonts?.ready.then(measure);
    return () => observer?.disconnect();
  }, [graphLabel, graphHeaderVisible, settings.density]);

  const columns = useMemo<readonly DataGridColumn[]>(() => {
    const refsLabel = t('working.commitTable.column.refs');
    const graphLabel = t('working.commitTable.column.graph');
    const subjectLabel = t('working.commitTable.column.subject');
    const authorLabel = t('working.commitTable.column.author');
    const dateLabel = t('working.commitTable.column.date');
    const shaLabel = t('working.commitTable.column.sha');

    return [
      { key: 'refs', header: refsLabel, name: refsLabel, width: 150, minWidth: 80 },
      // No ocultable — CU-2: sin ella la tabla deja de contar la historia. El
      // ancho de arranque es el que ocupan las calles que de verdad hay, hasta
      // el tope; `contentWidth` es el dibujo completo, y de la diferencia entre
      // los dos sale el scroll propio de la columna.
      {
        key: 'graph',
        header: (
          <span ref={graphHeaderRef} style={{ display: 'inline-block', width: 'max-content' }}>
            {graphLabel}
          </span>
        ),
        name: graphLabel,
        width: graphColumnWidth,
        minWidth: graphMinimum,
        maxWidth: Math.max(graphMinimum, graphWidth),
        hideable: false,
        contentWidth: graphWidth,
      },
      { key: 'subject', header: subjectLabel, name: subjectLabel, width: 320, grow: true },
      { key: 'author', header: authorLabel, name: authorLabel, width: 110, minWidth: 70 },
      { key: 'date', header: dateLabel, name: dateLabel, width: 150, minWidth: 130 },
      { key: 'sha', header: shaLabel, name: shaLabel, width: 90, minWidth: 70, align: 'end' },
    ];
  }, [graphColumnWidth, graphWidth, graphMinimum, t]);

  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  /*
   * La selección de commits, con la regla propia de CU-4: **el segundo clic
   * sobre el ya seleccionado deselecciona**.
   *
   * `selection.ts` no la trae porque en Repositorios el segundo clic *abre*, y
   * ahí no podía además apagar. Aquí sí, y la única forma de distinguirla es
   * que `applySelection` devuelva exactamente lo que ya había. Se comprueba el
   * botón del ratón porque el clic derecho también selecciona la fila antes de
   * abrir su menú, y abrir el menú de lo seleccionado no puede deseleccionarlo.
   */
  const buttonRef = useRef(0);

  const onSelectedChange = useCallback(
    (next: ReadonlySet<string>) => {
      const only = next.size === 1 ? [...next][0] : undefined;
      const repeated = only !== undefined && selected.size === 1 && selected.has(only);
      const resolved = repeated && buttonRef.current === 0 ? EMPTY_SELECTION : next;

      setSelected(resolved);

      const automatic = commitSelection(rows, resolved);
      const store = useWorkingStore.getState();

      if (automatic.points.length < 2) {
        if (store.compare?.trigger === 'selection') store.closeCompare();
        return;
      }

      const first = automatic.points[0];
      const last = automatic.points[automatic.points.length - 1];

      if (first === undefined || last === undefined) return;

      if (
        automatic.points.length >= 3 &&
        automatic.shas.length === automatic.points.length &&
        automatic.contiguous
      ) {
        store.openCompare({ kind: 'combined', shas: automatic.shas, trigger: 'selection' });
        return;
      }

      store.openCompare({
        kind: 'refs',
        source: first,
        target: last,
        trigger: 'selection',
      });
    },
    [rows, selected, setSelected],
  );

  // Cherry-pick y revertir aplican en el orden en que se ven las filas, que es
  // el del historial: quien seleccionó tres commits espera que se apliquen del
  // más viejo al más nuevo y no en el orden en que los fue pulsando.
  const selection = useMemo(() => commitSelection(rows, selected), [rows, selected]);

  const menuFor = useCallback(
    (row: CommitTableRow): RowMenu => {
      if (row.kind === 'stash') {
        return {
          items: stashMenu(menuContext, row.stash),
          label: t('working.menu.stash.label', { stash: stashName(row.stash) }),
        };
      }

      if (row.kind === 'wip') return { items: [], label: t('working.commitTable.wip') };

      // Con varios commits marcados y el clic sobre uno de ellos, el menú es el
      // de la selección entera: pulsar dentro de lo marcado no puede significar
      // «olvida los otros dos».
      if (selection.shas.length > 1 && selected.has(row.key)) {
        return {
          items: commitSelectionMenu(menuContext, selection),
          label: t('working.menu.selection.label', { count: selection.shas.length }),
          description: t('working.menu.selection.description', { count: selection.shas.length }),
        };
      }

      return {
        items: commitMenu(menuContext, row.commit),
        label: t('working.menu.commit.label', { sha: shortSha(row.commit.sha) }),
      };
    },
    [menuContext, selected, selection, t],
  );

  const labelMenuFor = useCallback(
    (item: RefLabelItem): RowMenu => {
      if (item.tag) {
        return {
          items: tagMenu(menuContext, item.tag),
          label: t('working.menu.tag.label', { tag: item.tag.name }),
        };
      }

      if (item.local) {
        return {
          items: localBranchMenu(menuContext, item.local),
          label: t('working.menu.branch.label', { branch: item.local.name }),
        };
      }

      if (item.remote) {
        return {
          items: remoteBranchMenu(menuContext, item.remote),
          label: t('working.menu.branch.label', { branch: item.remote.name }),
        };
      }

      return { items: [], label: item.name };
    },
    [menuContext, t],
  );

  const activateReference = useCallback(
    (item: RefLabelItem) => {
      if (item.local) {
        menuContext.actions.checkout({ kind: 'branch', name: item.local.name }, item.local.name);
        return;
      }

      if (item.remote) {
        const remoteName =
          item.remote.remote ?? menuContext.defaultRemote ?? item.remote.name.split('/')[0] ?? '';
        const shortName = item.remote.name.startsWith(`${remoteName}/`)
          ? item.remote.name.slice(remoteName.length + 1)
          : item.name;
        const local = refs.branches.find(
          (branch) =>
            branch.kind === 'local' &&
            (branch.upstream === item.remote?.name || branch.name === shortName),
        );
        tableActions.activateRemoteBranch(item.remote, local);
      }
    },
    [menuContext, refs.branches, tableActions],
  );

  const headerExtras = useMemo(
    () =>
      tableHeaderExtras(menuContext, {
        form: nodeForm,
        avatarAllowed: resolved.theme !== 'contraste',
      }),
    [menuContext, nodeForm, resolved.theme],
  );

  // «Ir a su nodo»: la fila del commit que se pidió, centrada. Si el commit no
  // está en las páginas cargadas todavía no se salta a ninguna parte — pedir
  // más páginas hasta encontrarlo es de la fase del scroll infinito, no de esta.
  useEffect(() => {
    if (!goTo || handledGoTo.current === goTo.nonce) return;

    const index = rows.findIndex(
      (row) =>
        (row.kind === 'commit' && row.commit.sha === goTo.sha) ||
        (row.kind === 'stash' && row.stash.sha === goTo.sha),
    );

    if (index >= 0) {
      handledGoTo.current = goTo.nonce;
      listRef.current?.scrollToIndex(index);
    }
  }, [goTo, rows]);

  // Reescribir el historial —cherry-pick, revertir, restablecer— invalida las
  // páginas ya cargadas: los commits de después del punto tocado ya no son los
  // mismos objetos.
  const seenVersion = useRef(historyVersion);

  useEffect(() => {
    if (seenVersion.current === historyVersion) return;

    seenVersion.current = historyVersion;
    pages.reload({ retain: true });
  }, [historyVersion, pages]);

  const classes = [styles.area, className].filter(Boolean).join(' ');

  if (pages.state.status === 'loading') {
    return (
      <div className={classes}>
        <CommitTableSkeleton />
      </div>
    );
  }

  if (pages.state.status === 'failed') {
    return (
      <div className={classes}>
        <div className={styles.error}>
          <GitErrorPanel error={pages.state.error} fixes={{ retry: pages.reload }} />
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={classes}>
        <div className={styles.empty}>
          <EmptyState
            title={t('working.commitTable.empty.title')}
            description={t('working.commitTable.empty.description')}
          />
        </div>
      </div>
    );
  }

  const label = t('working.commitTable.label', { repo: repoName });

  return (
    <div
      className={classes}
      onMouseDownCapture={(event) => {
        buttonRef.current = event.button;
      }}
    >
      <DataGrid
        columns={columns}
        label={label}
        rowCount={rows.length}
        storageId="working.commits"
        columnsMenuLabel={t('working.commitTable.columnsMenu')}
        columnsGroupLabel={t('working.menu.header.columns')}
        menuExtras={headerExtras}
        resetWidthsLabel={t('working.menu.header.resetWidths')}
        columnScrollLabel={t('working.commitTable.graphScroll')}
        className={styles.grid}
      >
        <VirtualList<CommitTableRow>
          items={rows}
          getKey={(row) => row.key}
          label={label}
          semantics="rowgroup"
          rowHeight={metrics.rowHeight}
          selectionMode="multiple"
          className={styles.historyScroll}
          selected={selected}
          onSelectedChange={onSelectedChange}
          handleRef={listRef}
          dragAutoScroll
          onRangeChange={({ endIndex }) => {
            if (endIndex >= rows.length - LOAD_MORE_THRESHOLD) pages.loadMore();
          }}
          renderRow={(row, context) => (
            <CommitRow
              row={row}
              index={context.index}
              selected={context.selected}
              dateFormat={dateFormat}
              graph={graph}
              labels={
                row.kind === 'commit' ? (labelsBySha.get(row.commit.sha) ?? NO_LABELS) : NO_LABELS
              }
              menu={menuFor(row)}
              labelMenu={labelMenuFor}
              onReferenceDrop={handleReferenceDrop}
              onReferenceActivate={activateReference}
              onRenameWip={(name) => {
                onRenameWip(name);
              }}
              onRenameStash={tableActions.renameStash}
            />
          )}
        />
      </DataGrid>
      {pages.state.loadingMore && (
        <div className={styles.loadingMore}>
          <Spinner size="sm" label={t('working.commitTable.loadingMore')} />
        </div>
      )}
    </div>
  );
}

/** El esqueleto de la fila «Tabla y grafo» de la sección 3 del subplan. */
export function CommitTableSkeleton() {
  const { t } = useI18n();
  const { settings } = useTheme();
  const rowHeightPx = commitRowHeight(settings.density, settings.uiFontSize);

  return (
    <div
      className={styles.skeletonArea}
      role="status"
      aria-label={t('working.commitTable.loading')}
    >
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} variant="block" style={{ height: rowHeightPx }} />
      ))}
    </div>
  );
}
