import { useCallback, useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import type { Commit } from '@core/domain/commit';
import { shortSha } from '@core/domain/commit';
import type { DiffSource } from '@core/domain/diff';
import type { RepoId } from '@core/domain/repository';
import type { FileChange } from '@core/domain/status';
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
import { mergeFileChanges, visibleFiles } from './staging';
import { useWorkingStore, type WorkingCompare } from './workingStore';

interface ComparePanelProps {
  repoId: RepoId;
  compare: WorkingCompare;
  menuContext: MenuBuildContext;
  onClose: () => void;
}

/**
 * Hasta dónde se recorre cada extremo para saber qué tiene de más.
 *
 * `GitPort` no expone «dame la diferencia entre estas dos referencias», así que
 * la comparación se calcula recorriendo los dos lados y restándolos. El tope
 * existe para que comparar dos ramas de una historia enorme no cueste la
 * historia entera; el falso de hoy tiene trescientos y pico commits y nunca lo
 * toca.
 */
const WALK_LIMIT = 5000;

/**
 * Cuántos commits del rango se abren para saber qué archivos tocaron.
 *
 * Cada uno cuesta un `readCommit`, y van en paralelo. Pasado el tope, la lista
 * de archivos es la de los más recientes y el panel lo dice en vez de fingir que
 * están todos.
 */
const FILES_LIMIT = 200;

interface CompareData {
  /** Commits que solo tiene el primer extremo. Vacío en el diff combinado. */
  sourceOnly: readonly Commit[];
  targetOnly: readonly Commit[];
  files: readonly FileChange[];
  /** La lista de archivos se armó con parte del rango, no con todo. */
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

/** Los archivos que tocaron esos commits, sumados en una lista sola. */
async function filesOf(
  git: GitPort,
  repoId: RepoId,
  commits: readonly Commit[],
  query: GitQuery,
): Promise<{ files: readonly FileChange[]; truncated: boolean }> {
  const considered = commits.slice(0, FILES_LIMIT);
  const details = await Promise.all(
    considered.map((commit) => git.readCommit(repoId, commit.sha, query)),
  );

  return {
    files: mergeFileChanges(details.flatMap((detail) => detail.files)),
    truncated: commits.length > considered.length,
  };
}

async function loadCompare(
  git: GitPort,
  repoId: RepoId,
  compare: WorkingCompare,
  query: GitQuery,
): Promise<CompareData> {
  if (compare.kind === 'combined') {
    // El diff combinado ya sabe qué commits suma: son los que se marcaron, y son
    // contiguos —lo comprueba el menú antes de ofrecerlo—.
    const details = await Promise.all(
      compare.shas.map((sha) => git.readCommit(repoId, sha, query)),
    );

    // `shas` llega del más viejo al más nuevo. El efecto neto de aplicarlos
    // juntos es lo que va del **padre** del primero al último; sin el padre
    // faltarían los cambios del commit más antiguo de la selección. Un commit
    // raíz no tiene padre, y entonces el rango arranca en él mismo.
    const oldest = details[0]?.commit;
    const newest = details[details.length - 1]?.commit;

    return {
      sourceOnly: [],
      targetOnly: [],
      files: mergeFileChanges([...details].reverse().flatMap((detail) => detail.files)),
      truncated: false,
      range: {
        kind: 'range',
        from: oldest?.parents[0] ?? oldest?.sha ?? '',
        to: newest?.sha ?? '',
      },
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

  const [refs, status] = targetIsWip
    ? await Promise.all([git.readRefs(repoId, query), git.readStatus(repoId, query)])
    : [null, null];
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

  const historyFiles = await filesOf(git, repoId, [...sourceOnly, ...targetOnly], query);
  const files =
    status === null
      ? historyFiles.files
      : mergeFileChanges([
          ...historyFiles.files,
          ...status.staged,
          ...status.unstaged,
          ...status.conflicted,
        ]);

  return {
    sourceOnly,
    targetOnly,
    files,
    truncated: historyFiles.truncated,
    // Rama, tag o SHA: los tres son lo que el puerto sabe resolver, y `Sha` es
    // una cadena precisamente para no tener dos tipos que dicen lo mismo.
    range: targetIsWip
      ? { kind: 'workingRange', from: sourceRef }
      : { kind: 'range', from: sourceRef, to: targetRef },
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
export function ComparePanel({ repoId, compare, menuContext, onClose }: ComparePanelProps) {
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

  const load = useCallback(
    (query: GitQuery) => loadCompare(git, repoId, compare, query),
    [compare, git, repoId],
  );

  const data = useAsyncData(load);

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
              {t('working.compare.truncated', { count: FILES_LIMIT })}
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
