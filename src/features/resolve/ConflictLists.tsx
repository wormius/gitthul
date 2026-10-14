import { useCallback, useMemo } from 'react';

import { useGestures } from '@app/GestureContext';
import type { FileChange, WorkingStatus } from '@core/domain/status';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Counter } from '@ui/Counter';
import { SplitPane } from '@ui/SplitPane';
import { FileList, type FileMenuTarget, type QuickAction } from '@features/working/FileList';
import { FileListToolbar } from '@features/working/FileListToolbar';
import type { RowMenu } from '@features/working/CommitRow';
import { visibleFiles } from '@features/working/staging';
import { useWorkingStore } from '@features/working/workingStore';

import styles from './ConflictLists.module.css';
import { useResolveStore } from './resolveStore';

interface ConflictListsBaseProps {
  status: WorkingStatus;
  /** Las dos ramas de la operación a medias, para nombrarlo todo. */
  ours: string;
  theirs: string;
  onMarkResolved: (paths: readonly string[]) => void;
  onUnresolve: (paths: readonly string[]) => void;
  onOpenResolved: (path: string) => void;
}

type ConflictListsProps = ConflictListsBaseProps &
  (
    | {
        kind: 'operation';
        operation: 'merge' | 'rebase' | 'cherryPick' | 'revert';
        onApply: () => void;
      }
    | {
        kind: 'stash';
        operation: 'apply' | 'pop' | 'autoStash';
        onApply: () => void;
      }
    | { kind: 'standalone' }
  );

/**
 * El paso 1 de Resolver: En conflicto y Resueltos, en el panel derecho.
 *
 * Sustituye a `StagingPanel` mientras la operación esté a medias, en el mismo
 * sitio y con el mismo reparto —dos listas y un divisor—, porque cambiar de
 * sitio lo que se mira sería pedirle a la persona que vuelva a aprenderse la
 * ventana justo cuando tiene un problema entre manos.
 *
 * **Qué está resuelto no se deduce de `WorkingStatus`.** Un archivo resuelto
 * queda preparado, y en el stage puede haber cosas de antes de la fusión; la
 * lista de Resueltos es la que el store lleva, alimentada por lo que esta
 * sesión resolvió y por lo que devolvió la autoresolución.
 */
export function ConflictLists(props: ConflictListsProps) {
  const { status, ours, theirs, onMarkResolved, onUnresolve, onOpenResolved } = props;
  const { t } = useI18n();
  const gestures = useGestures();

  const selected = useResolveStore((state) => state.selected);
  const setSelected = useResolveStore((state) => state.setSelected);
  const resolvedPaths = useResolveStore((state) => state.resolvedPaths);
  const openFile = useResolveStore((state) => state.openFile);
  const view = useWorkingStore((state) => state.fileView);
  const sort = useWorkingStore((state) => state.fileSort);
  const filter = useWorkingStore((state) => state.fileFilter);
  const treeExpanded = useWorkingStore((state) => state.fileTreeExpanded);
  const setView = useWorkingStore((state) => state.setFileView);
  const setSort = useWorkingStore((state) => state.setFileSort);
  const setFilter = useWorkingStore((state) => state.setFileFilter);
  const setTreeExpanded = useWorkingStore((state) => state.setFileTreeExpanded);

  const resolved = useMemo(
    () => status.staged.filter((change) => resolvedPaths.has(change.path)),
    [resolvedPaths, status.staged],
  );

  const conflictLabel = t('resolve.lists.conflicted');
  const resolvedLabel = t('resolve.lists.resolved');
  const matches = useMemo(
    () =>
      visibleFiles(status.conflicted, filter, sort).length +
      visibleFiles(resolved, filter, sort).length,
    [filter, resolved, sort, status.conflicted],
  );

  const emptyMenu = useCallback(
    (target: FileMenuTarget): RowMenu => ({
      items: [],
      label:
        target.kind === 'folder'
          ? t('working.menu.folder.label', { folder: target.path })
          : t('working.menu.file.label', { path: target.file.path }),
    }),
    [t],
  );

  const markQuickAction: QuickAction = useMemo(
    () => ({
      text: t('resolve.mark.action'),
      label: t('resolve.mark.one'),
      run: (path) => {
        onMarkResolved([path]);
      },
    }),
    [onMarkResolved, t],
  );

  const unresolveQuickAction: QuickAction = useMemo(
    () => ({
      text: t('resolve.mark.unresolve'),
      label: t('resolve.mark.unresolveOne'),
      danger: true,
      run: (path) => onUnresolve([path]),
    }),
    [onUnresolve, t],
  );

  const section = (title: string, files: readonly FileChange[], empty: string, done: boolean) => (
    <section className={styles.section} aria-label={title}>
      <header className={styles.header}>
        <span className={styles.title}>{title}</span>
        <Counter value={files.length} />
      </header>
      <FileList
        files={files}
        label={title}
        className={styles.list}
        view={view}
        sort={sort}
        filter={filter}
        selected={selected}
        onSelectedChange={setSelected}
        menuFor={emptyMenu}
        onOpen={done ? onOpenResolved : openFile}
        empty={empty}
        quickAction={done ? unresolveQuickAction : markQuickAction}
        showChangeDetails={false}
        treeExpanded={treeExpanded}
      />
    </section>
  );

  return (
    <div className={styles.panel}>
      <header className={styles.panelTitle}>
        {t(
          status.conflicted.length === 0
            ? 'resolve.lists.allResolved'
            : status.conflicted.length === 1
              ? 'resolve.lists.detectedOne'
              : 'resolve.lists.detectedMany',
          { count: status.conflicted.length },
        )}
      </header>
      <header className={styles.operation}>
        <span className={styles.operationTitle}>
          {props.kind === 'operation'
            ? t('resolve.operation.title', { source: theirs, target: ours })
            : props.kind === 'stash'
              ? t(
                  props.operation === 'autoStash'
                    ? 'resolve.stash.autoStashTitle'
                    : props.operation === 'pop'
                      ? 'resolve.stash.popTitle'
                      : 'resolve.stash.applyTitle',
                  { target: ours },
                )
              : t('resolve.standalone.title', { target: ours })}
        </span>
      </header>

      <FileListToolbar
        filter={filter}
        onFilterChange={setFilter}
        sort={sort}
        onSortChange={setSort}
        view={view}
        onViewChange={setView}
        treeExpanded={treeExpanded}
        onTreeExpandedChange={setTreeExpanded}
        matches={matches}
      />

      <div className={styles.split}>
        <SplitPane
          orientation="vertical"
          label={t('resolve.split.label')}
          storageId="resolve.lists"
          defaultRatio={0.6}
          minFirst={80}
          minSecond={80}
          first={section(
            conflictLabel,
            status.conflicted,
            t('resolve.lists.emptyConflicted'),
            false,
          )}
          second={section(resolvedLabel, resolved, t('resolve.lists.emptyResolved'), true)}
        />
      </div>

      {props.kind !== 'standalone' && (
        <footer className={styles.footer}>
          <Button
            size="sm"
            className={styles.finishAction}
            disabled={status.conflicted.length > 0}
            onClick={props.onApply}
          >
            {props.kind === 'stash' && props.operation === 'autoStash'
              ? t('resolve.stash.finishAutoStash')
              : t('resolve.close.finishKind', {
                  operation: t(
                    `working.operationBanner.kind.${
                      props.kind === 'stash'
                        ? props.operation === 'autoStash'
                          ? 'autoStash'
                          : props.operation === 'pop'
                            ? 'pop'
                            : 'stashApply'
                        : props.operation
                    }` as const,
                  ),
                })}
          </Button>
          {(props.kind === 'operation' || props.kind === 'stash') && (
            <Button
              size="sm"
              variant="ghost"
              disabled={status.conflicted.length > 0}
              onClick={() => {
                gestures.run('resolve.keepStaged');
              }}
            >
              {t('resolve.close.keepStaged')}
            </Button>
          )}
        </footer>
      )}
    </div>
  );
}
