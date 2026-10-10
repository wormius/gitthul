import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';

import type { FileChange } from '@core/domain/status';
import { useI18n } from '@i18n/useI18n';
import { ContextMenu } from '@ui/ContextMenu';
import { Button } from '@ui/Button';
import { Counter } from '@ui/Counter';
import { IconButton } from '@ui/IconButton';
import { Tree } from '@ui/Tree';
import { VirtualList } from '@ui/VirtualList';
import type { FlatTreeNode } from '@ui/treeUtils';

import { ChangeTypeIcon } from './ChangeTypeIcon';
import styles from './FileList.module.css';
import type { RowMenu } from './CommitRow';
import {
  buildFileTree,
  FOLDER_PREFIX,
  folderPathOf,
  isFolderId,
  menuPaths,
  splitPath,
  visibleFiles,
  type FileSort,
  type FileView,
} from './staging';

/** Sobre qué se abrió el menú: un archivo —o los marcados— o una carpeta. */
export type FileMenuTarget =
  | { kind: 'file'; file: FileChange; paths: readonly string[] }
  | { kind: 'folder'; path: string; paths: readonly string[] };

/**
 * Acción rápida de hover: un botón que aparece al pasar el puntero sobre la
 * fila y que ejecuta una acción sobre el archivo sin doble clic ni menú.
 *
 * Reserva su espacio siempre para no desplazar nada al aparecer — invariante 1.
 */
export interface QuickAction {
  /** Icono del botón (SVG). */
  icon?: ReactNode;
  /** Texto visible para acciones que no conviene representar solo con icono. */
  text?: string;
  danger?: boolean;
  /** Texto accesible — i18n, p. ej. «Pasar al stage». */
  label: string;
  /** Qué hacer con la ruta del archivo cuando se pulsa. */
  run: (path: string) => void;
}

interface FileListProps {
  /** Nombre accesible de la lista, p. ej. «Seguimiento». */
  label: string;
  files: readonly FileChange[];
  view: FileView;
  sort: FileSort;
  filter: string;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: ReadonlySet<string>) => void;
  menuFor: (target: FileMenuTarget) => RowMenu;
  /** Doble clic o Enter sobre un archivo. Sin ella, la fila solo se marca. */
  onActivate?: (paths: readonly string[]) => void;
  /**
   * Qué archivo quedó marcado a solas — el visor de diff de CU-5.
   *
   * Es un camino aparte de `onActivate` a propósito: en Seguimiento y en Stage
   * la activación ya está tomada por pasar y quitar del stage, y CU-5 pide que
   * el clic simple abra el visor **en cualquier lista**. Cuelga de la selección
   * y no de un `onClick` propio porque así el gesto es exactamente «lo que está
   * marcado es lo que se lee»: vale igual para el clic y para recorrer la lista
   * con las flechas, y con Ctrl o Mayús —donde se está armando una selección de
   * varios— no se abre nada, porque entonces lo marcado no es uno.
   */
  onOpen?: (path: string) => void;
  /** Qué se dice cuando no queda nada — por vacío o por filtro. */
  empty: string;
  /** Botón que aparece en hover para ejecutar la acción principal de la fila. */
  quickAction?: QuickAction;
  /** Texto secundario opcional al final de una fila. */
  trailingLabel?: (file: FileChange) => string | undefined;
  /** Oculta binario y conteos cuando el consumidor ofrece otra acción al final. */
  showChangeDetails?: boolean;
  /** Orden global de abrir o cerrar todas las carpetas del árbol. */
  treeExpanded?: boolean;
  className?: string;
}

/**
 * La lista de archivos cambiados, plana o en árbol — el componente que más
 * sitios comparte del panel derecho.
 *
 * Nace en `features/working/` a propósito: la regla de dos usos pide un segundo
 * consumidor antes de promoverla a `src/ui/`, y ese será Resolver en F3.1. Hasta
 * entonces sabe de `FileChange`, que es de dominio, y no puede vivir entre los
 * primitivos.
 *
 * **Clic simple selecciona y abre el visor de diff** —CU-5—, y la activación
 * —doble clic o Enter— hace lo que cada lista tenga: pasar al stage o quitarlo
 * en Seguimiento y en Stage, nada en las listas de solo lectura. Son dos caminos
 * distintos porque son dos acciones distintas, y `VirtualList` ya separa
 * selección de activación.
 */
export function FileList({
  label,
  files,
  view,
  sort,
  filter,
  selected,
  onSelectedChange,
  menuFor,
  onActivate,
  onOpen,
  empty,
  quickAction,
  trailingLabel,
  showChangeDetails = true,
  treeExpanded,
  className,
}: FileListProps) {
  const { t } = useI18n();

  const visible = useMemo(() => visibleFiles(files, filter, sort), [files, filter, sort]);
  const paths = useMemo(() => visible.map((file) => file.path), [visible]);
  const tree = useMemo(() => (view === 'tree' ? buildFileTree(visible) : []), [view, visible]);

  const byPath = useMemo(
    () => new Map(visible.map((file) => [file.path, file] as const)),
    [visible],
  );

  /*
   * El árbol expande por su cuenta todo lo que tiene dentro.
   *
   * Una lista de cambios no es un explorador de archivos: lo que se enseña son
   * las pocas rutas que cambiaron, y arrancar con todo plegado obligaría a abrir
   * tres carpetas para ver un archivo. Plegar sí se recuerda mientras la lista
   * viva, que es lo que `Tree` hace con `expanded`.
   */
  const allFolders = useMemo(() => {
    const ids = new Set<string>();

    const walk = (path: string) => {
      const parts = path.split('/');

      parts.pop();

      let prefix = '';

      for (const part of parts) {
        prefix += `${part}/`;
        ids.add(`${FOLDER_PREFIX}${prefix}`);
      }
    };

    for (const path of paths) walk(path);

    return ids;
  }, [paths]);

  const [expanded, setExpanded] = useControlledExpansion(allFolders);

  useEffect(() => {
    if (treeExpanded === undefined) return;
    setExpanded(treeExpanded ? allFolders : new Set());
  }, [allFolders, setExpanded, treeExpanded]);

  const rowMenu = useCallback(
    (id: string): RowMenu => {
      if (isFolderId(id)) {
        const folder = folderPathOf(id);
        const inside = paths.filter((path) => path.startsWith(folder));

        return menuFor({ kind: 'folder', path: folder, paths: inside });
      }

      const file = byPath.get(id);

      if (!file) return { items: [], label };

      return menuFor({ kind: 'file', file, paths: menuPaths(selected, [id], paths) });
    },
    [byPath, label, menuFor, paths, selected],
  );

  const activate = useCallback(
    (id: string) => {
      if (!onActivate || isFolderId(id)) return;

      onActivate(menuPaths(selected, [id], paths));
    },
    [onActivate, paths, selected],
  );

  const changeSelected = useCallback(
    (next: ReadonlySet<string>) => {
      onSelectedChange(next);

      if (!onOpen || next.size !== 1) return;

      const [only] = [...next];

      if (only !== undefined && !isFolderId(only)) onOpen(only);
    },
    [onOpen, onSelectedChange],
  );

  const fileRow = (file: FileChange, showDirectory = true) => {
    const { dir, name } = splitPath(file.path);
    const menu = rowMenu(file.path);
    const trailing = trailingLabel?.(file);

    return (
      <ContextMenu
        items={menu.items}
        label={menu.label}
        description={menu.description}
        className={styles.row}
      >
        <ChangeTypeIcon change={file.change} />
        <span className={styles.path}>
          {showDirectory && dir !== '' && <span className={styles.dir}>{dir}</span>}
          <span className={styles.name}>{name}</span>
        </span>
        {showChangeDetails && file.binary ? (
          <span className={styles.binary}>{t('working.fileList.binary')}</span>
        ) : showChangeDetails && file.change !== 'unmodified' ? (
          <span className={styles.counts}>
            {file.change !== 'deleted' && (
              <span className={styles.insertions}>+{file.insertions}</span>
            )}
            {file.change !== 'added' && file.change !== 'untracked' && (
              <span className={styles.deletions}>−{file.deletions}</span>
            )}
          </span>
        ) : null}
        {trailing && <span className={styles.trailing}>{trailing}</span>}
        {quickAction &&
          (quickAction.text ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={quickAction.label}
              className={
                quickAction.danger
                  ? `${styles.quickAction} ${styles.quickActionDanger}`
                  : `${styles.quickAction} ${styles.quickActionSuccess}`
              }
              onClick={(event: MouseEvent) => {
                event.stopPropagation();
                quickAction.run(file.path);
              }}
              onMouseDown={(event: MouseEvent) => event.stopPropagation()}
            >
              {quickAction.text}
            </Button>
          ) : quickAction.icon ? (
            <IconButton
              icon={quickAction.icon}
              aria-label={quickAction.label}
              size="sm"
              className={`${styles.quickAction} ${
                quickAction.danger ? styles.quickActionDanger : styles.quickActionSuccess
              }`}
              onClick={(event: MouseEvent) => {
                event.stopPropagation();
                quickAction.run(file.path);
              }}
              onMouseDown={(event: MouseEvent) => event.stopPropagation()}
            />
          ) : null)}
      </ContextMenu>
    );
  };

  if (visible.length === 0) {
    return (
      <div className={[styles.list, className].filter(Boolean).join(' ')}>
        <p className={styles.empty} role="status">
          {empty}
        </p>
      </div>
    );
  }

  if (view === 'tree') {
    return (
      <Tree
        className={[styles.list, className].filter(Boolean).join(' ')}
        nodes={tree}
        label={label}
        expanded={expanded}
        onExpandedChange={setExpanded}
        selectionMode="multiple"
        selected={selected}
        onSelectedChange={changeSelected}
        onActivate={(row) => {
          activate(row.id);
        }}
        renderNode={(row) => (
          <TreeRow
            row={row}
            rowMenu={rowMenu}
            render={(file) => fileRow(file, false)}
            byPath={byPath}
          />
        )}
      />
    );
  }

  return (
    <VirtualList<FileChange>
      className={[styles.list, className].filter(Boolean).join(' ')}
      items={visible}
      getKey={(file) => file.path}
      label={label}
      selectionMode="multiple"
      selected={selected}
      onSelectedChange={changeSelected}
      onActivate={(file) => {
        activate(file.path);
      }}
      renderRow={(file) => fileRow(file)}
    />
  );
}

interface TreeRowProps {
  row: FlatTreeNode;
  rowMenu: (id: string) => RowMenu;
  render: (file: FileChange) => ReactNode;
  byPath: ReadonlyMap<string, FileChange>;
}

/**
 * Una fila del modo árbol: carpeta o archivo.
 *
 * La carpeta enseña su cuenta de cambios **solo plegada**, que es cuando el
 * número dice algo que no se ve; desplegada, contarlos sería repetir lo que ya
 * está debajo.
 */
function TreeRow({ row, rowMenu, render, byPath }: TreeRowProps) {
  const file = byPath.get(row.id);

  if (file) return render(file);

  const menu = rowMenu(row.id);

  return (
    <ContextMenu
      items={menu.items}
      label={menu.label}
      description={menu.description}
      className={styles.folder}
    >
      <span className={styles.folderName}>{row.label}</span>
      {!row.expanded && <Counter value={row.leafCount} />}
    </ContextMenu>
  );
}

/**
 * El plegado del árbol, arrancando con todo abierto.
 *
 * No vive en el store porque no sobrevive a nada: cambiar de commit trae otras
 * carpetas, y recordar que `src/app/` estaba plegada en la lista de otro commit
 * no significaría nada.
 */
function useControlledExpansion(
  all: ReadonlySet<string>,
): [ReadonlySet<string>, (next: ReadonlySet<string>) => void] {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const expanded = useMemo(() => {
    const open = new Set(all);

    for (const id of collapsed) open.delete(id);

    return open;
  }, [all, collapsed]);

  const setExpanded = useCallback(
    (next: ReadonlySet<string>) => {
      const shut = new Set<string>();

      for (const id of all) if (!next.has(id)) shut.add(id);

      setCollapsed(shut);
    },
    [all],
  );

  return [expanded, setExpanded];
}
