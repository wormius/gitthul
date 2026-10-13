import { useCallback, useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import type { Commit } from '@core/domain/commit';
import { shortSha } from '@core/domain/commit';
import type { DiffSource } from '@core/domain/diff';
import type { RepoId } from '@core/domain/repository';
import type { FileChange, WorkingStatus } from '@core/domain/status';
import type { GitPort, GitQuery } from '@core/ports/GitPort';
import { useI18n } from '@i18n/useI18n';
import { EmptyState } from '@ui/EmptyState';
import { IconButton } from '@ui/IconButton';
import { Spinner } from '@ui/Spinner';

import styles from './ComparePanel.module.css';
import type { CompareSide, MenuBuildContext } from './contextMenus';
import { commitFileMenu } from './contextMenus';
import { FileList, type FileMenuTarget } from './FileList';
import { FileListToolbar } from './FileListToolbar';
import type { RowMenu } from './CommitRow';
import { visibleFiles } from './staging';
import { useWorkingStore, type WorkingCompare } from './workingStore';

interface ComparePanelProps {
  repoId: RepoId;
  compare: WorkingCompare;
  status: WorkingStatus | null;
  menuContext: MenuBuildContext;
  onClose: () => void;
}

/**
 * Hasta dónde se recorre cada extremo para saber qué tiene de más.
 *
 * Este recorrido solo calcula los recuentos del historial. Los archivos salen
 * del diff neto entre los extremos, sin límites de commits ni uniones de sus
 * cambios intermedios.
 */
const WALK_LIMIT = 5000;

interface CompareData {
  /** Commits que solo tiene el primer extremo. Vacío en el diff combinado. */
  sourceOnly: readonly Commit[];
  targetOnly: readonly Commit[];
  files: readonly FileChange[];
  /** Los recuentos de commits solo recorrieron parte de la historia. */
  truncated: boolean;
  /**
   * Los dos extremos con los que el visor pide el diff de un archivo — CU-5.
   *
   * Sale de la carga y no de las props porque en el diff combinado el extremo de
   * partida es **el padre** del commit más antiguo de la selección, y quién es
   * ese padre solo se sabe después de leer el commit.
   */
  range: DiffSource;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

async function loadCompare(
  git: GitPort,
  repoId: RepoId,
  compare: WorkingCompare,
  query: GitQuery,
): Promise<CompareData> {
  if (compare.kind === 'combined') {
    const first = compare.shas[0];
    const last = compare.shas[compare.shas.length - 1];
    if (first === undefined || last === undefined) {
      throw new Error('La comparación necesita commits seleccionados');
    }
    const oldest = (await git.readCommit(repoId, first, query)).commit;
    // Incluye el primer commit: un rango que empieza en la raíz compara desde
    // el árbol vacío. Los cambios que se anulan dentro del rango desaparecen.
    const range: DiffSource = {
      kind: 'range',
      from: oldest.parents[0] ?? null,
      to: last,
    };

    return {
      sourceOnly: [],
      targetOnly: [],
      files: await git.readDiffFiles(repoId, range, query),
      truncated: false,
      range,
    };
  }

  /*
   * Los dos lados se restan aquí y no en el puerto.
   *
   * `previewIntegration` daría los commits de un lado en una sola llamada, pero
   * solo acepta **nombres de rama**: «Comparar `v1.2.0` con `main`» y «Comparar
   * `a1b2c3d` con `e4f5g6h`», que son dos de los tres caminos de CU-14, no
   * pasarían por ahí. `readCommits` con `start` resuelve rama, tag y SHA por
   * igual, así que la comparación es una sola para los tres casos.
   */
  const sourceRef = revisionRef(compare.source);
  const targetIsWip = compare.target.kind === 'wip';

  if (sourceRef === null) {
    throw new Error('WIP solo puede ser el extremo más reciente de una comparación');
  }

  const refs = targetIsWip ? await git.readRefs(repoId, query) : null;
  const targetRef = targetIsWip ? refs?.head.sha : revisionRef(compare.target);

  if (targetRef === null || targetRef === undefined) {
    throw new Error('La comparación necesita una revisión de destino');
  }

  const [left, right] = await Promise.all([
    git.readCommits(repoId, { start: sourceRef, limit: WALK_LIMIT }, query),
    git.readCommits(repoId, { start: targetRef, limit: WALK_LIMIT }, query),
  ]);

  const leftShas = new Set(left.commits.map((commit) => commit.sha));
  const rightShas = new Set(right.commits.map((commit) => commit.sha));

  const sourceOnly = left.commits.filter((commit) => !rightShas.has(commit.sha));
  const targetOnly = right.commits.filter((commit) => !leftShas.has(commit.sha));

  // Fija las revisiones que se leyeron: si una rama o tag se mueve después,
  // abrir un archivo sigue comparando los mismos árboles que esta lista.
  const range: DiffSource = targetIsWip
    ? { kind: 'workingRange', from: left.commits[0]?.sha ?? sourceRef }
    : {
        kind: 'range',
        from: left.commits[0]?.sha ?? sourceRef,
        to: right.commits[0]?.sha ?? targetRef,
      };

  return {
    sourceOnly,
    targetOnly,
    files: await git.readDiffFiles(repoId, range, query),
    truncated: left.hasMore || right.hasMore,
    range,
  };
}

function revisionRef(side: CompareSide): string | null {
  return side.kind === 'wip' ? null : side.ref;
}

const NOTHING: ReadonlySet<string> = new Set();

/**
 * El estado de comparación del panel derecho — CU-14.
 *
 * Tres caminos llegan aquí: comparar dos referencias desde el menú de una rama o
 * de un tag, comparar dos commits marcados, y el diff combinado de una selección
 * contigua de tres o más. Los tres enseñan lo mismo —el rango nombrado y los
 * archivos que cambian—, y solo el primero puede además decir cuántos commits
 * tiene cada lado de más, que es lo único que no significa nada en un rango de
 * un solo sentido.
 *
 * Clic en un archivo abre el visor con `source: { kind: 'range', from, to }` —
 * CU-5 y CU-14.
 */
export function ComparePanel({ repoId, compare, status, menuContext, onClose }: ComparePanelProps) {
  const { t } = useI18n();
  const { git } = usePorts();

  const view = useWorkingStore((state) => state.fileView);
  const sort = useWorkingStore((state) => state.fileSort);
  const filter = useWorkingStore((state) => state.fileFilter);
  const setView = useWorkingStore((state) => state.setFileView);
  const treeExpanded = useWorkingStore((state) => state.fileTreeExpanded);
  const setTreeExpanded = useWorkingStore((state) => state.setFileTreeExpanded);
  const setSort = useWorkingStore((state) => state.setFileSort);
  const setFilter = useWorkingStore((state) => state.setFileFilter);
  const filterFocus = useWorkingStore((state) => state.filterFocus);

  const [selected, setSelected] = useState<ReadonlySet<string>>(NOTHING);
  const historyVersion = useWorkingStore((state) => state.historyVersion);
  const liveStatus = compare.kind === 'refs' && compare.target.kind === 'wip' ? status : null;

  const load = useCallback(
    (query: GitQuery) => loadCompare(git, repoId, compare, query),
    // Historial y WIP son señales de invalidación, no argumentos de lectura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compare, git, repoId, historyVersion, liveStatus],
  );

  const data = useAsyncData(load, { resourceKey: JSON.stringify([repoId, compare]) });

  const range = data.status === 'ready' ? data.data.range : null;

  const menuFor = useCallback(
    (target: FileMenuTarget): RowMenu => {
      if (target.kind === 'folder') {
        return { items: [], label: t('working.menu.folder.label', { folder: target.path }) };
      }

      return {
        // Sin rango todavía no hay diff que ofrecer: el extremo de partida del
        // combinado sale de la carga, no de la selección.
        items: range === null ? [] : commitFileMenu(menuContext, target.file.path, range),
        label: t('working.menu.file.label', { path: target.file.path }),
      };
    },
    [menuContext, range, t],
  );

  const open = useCallback(
    (path: string) => {
      if (range === null) return;

      menuContext.actions.openDiff(path, range);
    },
    [menuContext, range],
  );

  const title =
    compare.kind === 'combined'
      ? t('working.compare.combinedTitle', {
          count: compare.shas.length,
          from: shortSha(compare.shas[0] ?? ''),
          to: shortSha(compare.shas[compare.shas.length - 1] ?? ''),
        })
      : t('working.compare.title', {
          source: compare.source.label,
          target: compare.target.label,
        });

  const files = data.status === 'ready' ? data.data.files : [];
  const matches = visibleFiles(files, filter, sort).length;

  return (
    <section
      className={styles.panel}
      aria-label={title}
      onKeyDown={(event) => {
        // `Esc` cierra la comparación mientras el foco esté dentro, como el
        // visor de diff hará con el suyo: local y fuera del registro central,
        // que ya tiene esa tecla tomada por «cerrar el modo» del shell.
        if (event.key !== 'Escape') return;

        event.stopPropagation();
        onClose();
      }}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <IconButton
          icon={<CloseIcon />}
          aria-label={t('working.compare.close')}
          onClick={onClose}
        />
      </header>

      {data.status === 'loading' && (
        <div className={styles.centered}>
          <Spinner label={t('working.compare.loading', { range: title })} />
        </div>
      )}

      {data.status === 'failed' && (
        <div className={styles.error}>
          <GitErrorPanel error={data.error} fixes={{ retry: data.reload }} />
        </div>
      )}

      {data.status === 'ready' && (
        <>
          {compare.kind === 'refs' && (
            <ul className={styles.sides}>
              <li>
                {t('working.compare.ahead', {
                  ref: compare.source.label,
                  other: compare.target.label,
                  count: data.data.sourceOnly.length,
                })}
              </li>
              <li>
                {t('working.compare.ahead', {
                  ref: compare.target.label,
                  other: compare.source.label,
                  count: data.data.targetOnly.length,
                })}
              </li>
            </ul>
          )}

          {data.data.truncated && (
            <p className={styles.truncated}>
              {t('working.compare.truncated', { count: WALK_LIMIT })}
            </p>
          )}

          {data.data.files.length === 0 ? (
            <div className={styles.centered}>
              <EmptyState
                size="sm"
                title={t('working.compare.empty.title')}
                description={
                  compare.kind === 'combined'
                    ? t('working.compare.empty.combined', { count: compare.shas.length })
                    : t('working.compare.empty.description', {
                        source: compare.source.label,
                        target: compare.target.label,
                      })
                }
              />
            </div>
          ) : (
            <>
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
                focusRequest={filterFocus}
              />
              <FileList
                label={t('working.compare.files', { range: title })}
                files={data.data.files}
                view={view}
                sort={sort}
                filter={filter}
                selected={selected}
                onSelectedChange={setSelected}
                menuFor={menuFor}
                onOpen={open}
                empty={t('working.compare.noMatches')}
                treeExpanded={treeExpanded}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
