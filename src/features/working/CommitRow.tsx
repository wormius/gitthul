import { useCallback, useRef, useState, type ReactNode } from 'react';

import { shortSha } from '@core/domain/commit';
import type { Stash } from '@core/domain/refs';
import { useI18n } from '@i18n/useI18n';
import { ContextMenu } from '@ui/ContextMenu';
import { Counter } from '@ui/Counter';
import { DataGridCell } from '@ui/DataGridCell';
import { DataGridRow } from '@ui/DataGridRow';
import type { MenuEntry } from '@ui/menu';

import { CommitGraph, type GraphColumn } from './CommitGraph';
import type { CommitTableRow } from './commits';
import type { DragRef } from './integration';
import { RefConnector } from './RefConnector';
import { RefLabelCluster } from './RefLabelCluster';
import type { RefLabelItem } from './refs';
import styles from './CommitRow.module.css';

/** Un menú listo para montar: sus entradas y cómo se llama. */
export interface RowMenu {
  items: readonly MenuEntry[];
  label: string;
  description?: string;
}

interface CommitRowProps {
  row: CommitTableRow;
  index: number;
  selected: boolean;
  dateFormat: Intl.DateTimeFormat;
  graph: GraphColumn;
  /** Las ramas y tags de esta fila, una por referencia real. */
  labels: readonly RefLabelItem[];
  /** El menú de la fila: el del commit, o el de la selección si son varios. */
  menu: RowMenu;
  /** El menú de cada etiqueta: rama local, rama remota o tag. */
  labelMenu: (item: RefLabelItem) => RowMenu;
  /** Una referencia de la tabla se soltó sobre otra. */
  onReferenceDrop: (source: DragRef, target: DragRef) => void;
  onReferenceActivate: (item: RefLabelItem) => void;
  /** Doble clic en WIP confirma nuevo nombre; `null` si el nodo no es editable. */
  onRenameWip?: (name: string) => void;
  /** Doble clic en un stash confirma nuevo mensaje. */
  onRenameStash?: (stash: Stash, message: string) => void;
}

/**
 * Una fila de `CommitTable`: WIP, guardado o commit de verdad.
 *
 * La columna Rama/Tag enseña una referencia más `+N`; cada una mantiene su menú
 * y sus gestos en la fila y en el flotante. `RefConnector` llega hasta el borde
 * de esa celda y `CommitGraph` continúa el mismo trazo hasta el nodo exacto.
 */
export function CommitRow({
  row,
  index,
  selected,
  dateFormat,
  graph,
  labels,
  menu,
  labelMenu,
  onReferenceDrop,
  onReferenceActivate,
  onRenameWip,
  onRenameStash,
}: CommitRowProps) {
  const { t } = useI18n();
  const withMenu = (content: ReactNode) => (
    <ContextMenu
      role="presentation"
      items={menu.items}
      label={menu.label}
      {...(menu.description === undefined ? {} : { description: menu.description })}
      className={styles.region}
    >
      {content}
    </ContextMenu>
  );

  const hasLabels = labels.length > 0;
  const refsCell = (
    <DataGridCell columnKey="refs" className={styles.refsCell}>
      <RefLabelCluster
        items={labels}
        wrap={(item, label) => (
          <ContextMenu items={labelMenu(item).items} label={labelMenu(item).label}>
            {label}
          </ContextMenu>
        )}
        onReferenceDrop={onReferenceDrop}
        onReferenceActivate={onReferenceActivate}
      />
      {hasLabels && <RefConnector column={graph} row={index} />}
    </DataGridCell>
  );

  if (row.kind === 'wip') {
    return withMenu(
      <DataGridRow index={index} selected={selected}>
        <DataGridCell columnKey="refs">{null}</DataGridCell>
        <DataGridCell columnKey="graph">
          <CommitGraph column={graph} row={index} author="" />
        </DataGridCell>
        <DataGridCell columnKey="subject">
          <InlineLabel
            value={row.label ?? 'WIP'}
            onConfirm={onRenameWip ? (v) => onRenameWip(v) : undefined}
          />
          <Counter value={row.fileCount} />
        </DataGridCell>
        <DataGridCell columnKey="author">{null}</DataGridCell>
        <DataGridCell columnKey="date">{null}</DataGridCell>
        <DataGridCell columnKey="sha">{null}</DataGridCell>
      </DataGridRow>,
    );
  }

  if (row.kind === 'stash') {
    const { stash } = row;

    return withMenu(
      <DataGridRow index={index} selected={selected}>
        <DataGridCell columnKey="refs">{null}</DataGridCell>
        <DataGridCell columnKey="graph">
          <CommitGraph column={graph} row={index} author="" />
        </DataGridCell>
        <DataGridCell columnKey="subject">
          <InlineLabel
            value={stash.message}
            onConfirm={onRenameStash ? (v) => onRenameStash(stash, v) : undefined}
          />
        </DataGridCell>
        <DataGridCell columnKey="author">{null}</DataGridCell>
        <DataGridCell columnKey="date">{dateFormat.format(stash.createdAt)}</DataGridCell>
        <DataGridCell columnKey="sha">
          <code className={styles.sha}>{shortSha(stash.sha)}</code>
        </DataGridCell>
      </DataGridRow>,
    );
  }

  const { commit } = row;

  return withMenu(
    <DataGridRow index={index} selected={selected}>
      {refsCell}
      <DataGridCell columnKey="graph">
        <CommitGraph
          column={graph}
          row={index}
          author={commit.author.name}
          connectFromLeft={hasLabels}
        />
      </DataGridCell>
      <DataGridCell columnKey="subject">
        <span className={styles.subject}>{commit.summary}</span>
      </DataGridCell>
      <DataGridCell columnKey="author">{commit.author.name}</DataGridCell>
      <DataGridCell columnKey="date">
        <span
          title={`${t('working.commitDetails.authoredAt')}: ${dateFormat.format(commit.authoredAt)}\n${t('working.commitDetails.committedAt')}: ${dateFormat.format(commit.committedAt)}`}
        >
          {dateFormat.format(commit.committedAt)}
        </span>
      </DataGridCell>
      <DataGridCell columnKey="sha">
        <code className={styles.sha} title={commit.sha}>
          {shortSha(commit.sha)}
        </code>
      </DataGridCell>
    </DataGridRow>,
  );
}

/**
 * Texto editable en la propia fila: doble clic abre un input; Enter o pérdida
 * de foco confirma; Escape cancela. Sin `onConfirm` se comporta como un span.
 */
function InlineLabel({ value, onConfirm }: { value: string; onConfirm?: (next: string) => void }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const start = useCallback(() => {
    if (!onConfirm) return;

    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.select();
    });
  }, [onConfirm]);

  const commit = useCallback(() => {
    const trimmed = inputRef.current?.value.trim() ?? '';

    setEditing(false);

    if (trimmed !== '' && trimmed !== value) onConfirm?.(trimmed);
  }, [onConfirm, value]);

  const cancel = useCallback(() => {
    setEditing(false);
  }, []);

  if (!editing) {
    return (
      <span className={styles.subject} onDoubleClick={start}>
        {value}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      className={styles.subject}
      defaultValue={value}
      autoFocus
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        else if (event.key === 'Escape') cancel();
      }}
    />
  );
}
