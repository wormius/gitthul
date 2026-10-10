import { useCallback, useMemo, type ReactNode } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { BranchIcon, WorktreeIcon } from '@app/ShellIcons';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import { shortSha, type Commit } from '@core/domain/commit';
import type { Branch, RefsSnapshot } from '@core/domain/refs';
import type { RepoId, Repository, RepoOperation, RepoSummary } from '@core/domain/repository';
import type { WorkingStatus } from '@core/domain/status';
import { isoDay } from '@core/domain/library';
import type { GitPort, GitQuery } from '@core/ports/GitPort';
import type { I18nContextValue } from '@i18n/I18nContext';
import type { MessageKey } from '@i18n/messages';
import { useI18n } from '@i18n/useI18n';
import { Avatar } from '@ui/Avatar';
import { Badge } from '@ui/Badge';
import { Button } from '@ui/Button';
import type { HeatmapCell } from '@ui/heatmapUtils';
import { Spinner } from '@ui/Spinner';

import { ActivityHeatmap } from './ActivityHeatmap';
import { useRepositoriesStore } from './repositoriesStore';
import { OpenFolderIcon } from './RepositoryIcons';
import {
  activityDays,
  contributors,
  headBranch,
  refCounts,
  statsSince,
  STATS_COMMIT_LIMIT,
  STATS_MONTHS,
} from './stats';
import { useRepositoryActions } from './useRepositoryActions';
import styles from './RepoStatsPanel.module.css';

/** Todo lo que los cuatro bloques necesitan, de una sola consulta cancelable. */
interface RepoStats {
  repository: Repository;
  refs: RefsSnapshot;
  status: WorkingStatus;
  /** Los del periodo, que son los que alimentan actividad y contribuidores. */
  recent: readonly Commit[];
  /** Cuántos hay en el periodo, que puede ser más de los que caben en el tope. */
  recentTotal: number;
  /** Los de siempre, que salen del `total` de la página sin acotar. */
  totalCommits: number;
  firstCommitAt: number | null;
  lastCommitAt: number | null;
  /** El instante de la consulta: el heatmap ancla aquí su extremo derecho. */
  at: number;
}

/**
 * Las seis consultas de las estadísticas, en paralelo salvo una.
 *
 * **El recorrido se acota y eso es parte del contrato.** Los commits del periodo
 * llegan con `since` y con tope, así que un repositorio de cien mil commits
 * cuesta lo mismo que uno de trescientos; la cifra absoluta sale del `total` de
 * una página de uno sin acotar, que git sabe contar sin traer nada.
 *
 * La única secuencial es la del commit más antiguo, que se pide **por su
 * posición** en cuanto se sabe cuántos hay. Recorrer la historia entera para
 * leer una fecha sería exactamente lo que la ventana evita.
 */
async function readStats(git: GitPort, id: RepoId, query: GitQuery): Promise<RepoStats> {
  const at = Date.now();

  const [repository, refs, status, period, newest] = await Promise.all([
    git.readRepository(id, query),
    git.readRefs(id, query),
    git.readStatus(id, query),
    git.readCommits(id, { since: statsSince(at), limit: STATS_COMMIT_LIMIT }, query),
    git.readCommits(id, { limit: 1 }, query),
  ]);

  const oldest =
    newest.total > 1
      ? await git.readCommits(id, { skip: newest.total - 1, limit: 1 }, query)
      : newest;

  return {
    repository,
    refs,
    status,
    recent: period.commits,
    recentTotal: period.total,
    totalCommits: newest.total,
    firstCommitAt: oldest.commits[0]?.committedAt ?? null,
    lastCommitAt: newest.commits[0]?.committedAt ?? null,
    at,
  };
}

const OPERATION_KEYS: Record<Exclude<RepoOperation['kind'], 'none'>, MessageKey> = {
  merge: 'repositories.stats.operation.merge',
  rebase: 'repositories.stats.operation.rebase',
  cherryPick: 'repositories.stats.operation.cherryPick',
  revert: 'repositories.stats.operation.revert',
  bisect: 'repositories.stats.operation.bisect',
};

interface RepoStatsPanelProps {
  repo: RepoSummary;
}

/**
 * Los cuatro bloques de CU-11: identidad, actividad, conteos y contribuidores.
 *
 * Todo se pide con la selección y **se cancela al cambiarla**: `useAsyncData`
 * ata la señal al cambio de `load`, que depende del identificador, así que
 * seleccionar cinco repositorios seguidos deja cuatro peticiones abortadas y
 * ningún panel de error — cancelar no es fallar, nunca.
 */
export function RepoStatsPanel({ repo }: RepoStatsPanelProps) {
  const { t, locale } = useI18n();
  const { git } = usePorts();
  const actions = useRepositoryActions();
  const repositories = useRepositoriesStore((state) => state.repositories);
  const select = useRepositoriesStore((state) => state.select);

  const load = useCallback((query: GitQuery) => readStats(git, repo.id, query), [git, repo.id]);
  const stats = useAsyncData(load);

  const dates = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }), [locale]);
  const numbers = useMemo(() => new Intl.NumberFormat(locale), [locale]);

  if (stats.status === 'loading') {
    return (
      <div className={styles.centered}>
        <Spinner label={t('repositories.stats.loading', { repo: repo.name })} />
      </div>
    );
  }

  if (stats.status === 'failed') {
    return (
      <div className={styles.centered}>
        <GitErrorPanel
          error={stats.error}
          fixes={{
            retry: stats.reload,
            locateRepo: () => {
              actions.locate(repo);
            },
            forgetRepo: () => {
              useRepositoriesStore.getState().openDialog({ kind: 'forget', repo });
            },
          }}
        />
      </div>
    );
  }

  const { data } = stats;
  const counts = refCounts(data.refs);
  const head = headBranch(data.refs);
  const authors = contributors(data.recent);
  const days = activityDays(data.recent);
  const parent =
    data.repository.worktreeOf === undefined
      ? undefined
      : repositories?.find((candidate) => candidate.id === data.repository.worktreeOf);
  const day = (cell: HeatmapCell) =>
    t('repositories.stats.heatmapDay', {
      count: cell.value,
      date: dates.format(new Date(`${cell.date}T00:00:00`)),
    });

  return (
    <div className={styles.panel}>
      <Block title={data.repository.name} heading="page">
        <dl className={styles.facts}>
          <Fact label={t('repositories.stats.path')}>
            <span className={styles.path}>{data.repository.path}</span>
            <Button
              size="sm"
              variant="ghost"
              iconStart={<OpenFolderIcon className={styles.icon} />}
              onClick={() => {
                actions.reveal(repo);
              }}
            >
              {t('repositories.stats.reveal')}
            </Button>
          </Fact>

          <Fact label={t('repositories.stats.head')}>
            <span className={styles.tag}>
              <BranchIcon className={styles.icon} />
              {data.refs.head.detached
                ? t('repositories.stats.detached', { sha: shortSha(data.refs.head.sha) })
                : (data.refs.head.branch ?? data.repository.head)}
            </span>
          </Fact>

          <Fact label={t('repositories.stats.remotes')}>
            {data.repository.remotes.length === 0 ? (
              <span className={styles.muted}>{t('repositories.stats.noRemotes')}</span>
            ) : (
              <ul className={styles.remotes}>
                {data.repository.remotes.map((remote) => (
                  <li key={remote.name}>
                    <span className={styles.remoteName}>{remote.name}</span>
                    <span className={styles.path}>{remote.fetchUrl}</span>
                  </li>
                ))}
              </ul>
            )}
          </Fact>

          {data.firstCommitAt !== null && (
            <Fact label={t('repositories.stats.firstCommit')}>
              {dates.format(new Date(data.firstCommitAt))}
            </Fact>
          )}

          {data.lastCommitAt !== null && (
            <Fact label={t('repositories.stats.lastCommit')}>
              {dates.format(new Date(data.lastCommitAt))}
            </Fact>
          )}
        </dl>

        <div className={styles.marks}>
          {parent && (
            <Button
              size="sm"
              variant="ghost"
              iconStart={<WorktreeIcon className={styles.icon} />}
              onClick={() => {
                select(parent);
              }}
            >
              {t('repositories.stats.goToParent', { repo: parent.name })}
            </Button>
          )}

          {data.repository.worktreeOf !== undefined && !parent && (
            <Badge>
              {t('repositories.stats.worktreeOf', { repo: data.repository.worktreeOf })}
            </Badge>
          )}

          {data.repository.bare && <Badge variant="info">{t('repositories.stats.bare')}</Badge>}

          {data.repository.hasSubmodules && (
            <Badge variant="info">{t('repositories.stats.submodules')}</Badge>
          )}
        </div>
      </Block>

      <Block title={t('repositories.stats.activity')}>
        {days.length === 0 ? (
          <p className={styles.muted}>{emptyReason(t, data)}</p>
        ) : (
          <ActivityHeatmap
            days={days}
            end={isoDay(data.at)}
            label={t('repositories.stats.heatmapLabel', {
              repo: data.repository.name,
              months: STATS_MONTHS,
            })}
            total={t('repositories.stats.heatmapTotal', {
              count: numbers.format(data.recentTotal),
              months: STATS_MONTHS,
            })}
            describeDay={day}
          />
        )}
      </Block>

      <Block title={t('repositories.stats.counts')}>
        <dl className={styles.counts}>
          <Count
            label={t('repositories.stats.commits')}
            value={numbers.format(data.totalCommits)}
          />
          <Count
            label={t('repositories.stats.localBranches')}
            value={numbers.format(counts.localBranches)}
          />
          <Count
            label={t('repositories.stats.remoteBranches')}
            value={numbers.format(counts.remoteBranches)}
          />
          <Count label={t('repositories.stats.tags')} value={numbers.format(counts.tags)} />
          <Count label={t('repositories.stats.stashes')} value={numbers.format(counts.stashes)} />
          <Count
            label={t('repositories.stats.worktrees')}
            value={numbers.format(counts.worktrees)}
          />
        </dl>

        <div className={styles.marks}>
          {data.repository.operation.kind !== 'none' && (
            <Badge variant="warning">
              {t(OPERATION_KEYS[data.repository.operation.kind], {
                branch: data.refs.head.branch ?? shortSha(data.refs.head.sha),
              })}
            </Badge>
          )}

          {data.status.conflicted.length > 0 && (
            <Badge variant="danger">
              {t('repositories.stats.conflicted', { count: data.status.conflicted.length })}
            </Badge>
          )}

          {data.status.staged.length > 0 && (
            <Badge variant="accent">
              {t('repositories.stats.staged', { count: data.status.staged.length })}
            </Badge>
          )}

          {data.status.unstaged.length > 0 && (
            <Badge>
              {t('repositories.stats.unstaged', { count: data.status.unstaged.length })}
            </Badge>
          )}

          {data.status.clean && <Badge variant="success">{t('repositories.stats.clean')}</Badge>}

          {head && <Divergence branch={head} />}
        </div>
      </Block>

      <Block title={t('repositories.stats.contributors')}>
        {authors.length === 0 ? (
          <p className={styles.muted}>{emptyReason(t, data)}</p>
        ) : (
          <>
            <ul className={styles.authors}>
              {authors.map(({ person, commits }) => (
                <li className={styles.author} key={person.email}>
                  <Avatar name={person.name} email={person.email} size="sm" />
                  <span className={styles.authorName}>{person.name}</span>
                  <span className={styles.authorCount}>
                    {t('repositories.stats.contributorCommits', {
                      count: numbers.format(commits),
                    })}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.period}>
              {t('repositories.stats.period', { months: STATS_MONTHS })}
            </p>
          </>
        )}
      </Block>
    </div>
  );
}

/**
 * Por qué los dos bloques del periodo están vacíos.
 *
 * No es lo mismo un repositorio recién creado que uno con diez años de historia
 * parado desde hace dos: el primero no tiene nada que contar y el segundo sí,
 * solo que fuera de la ventana. Decir «todavía no hay historia» sobre el segundo
 * sería mentir con la cifra de commits totales justo encima contradiciéndolo.
 */
function emptyReason(t: I18nContextValue['t'], data: RepoStats): string {
  return data.totalCommits === 0
    ? t('repositories.stats.noHistory')
    : t('repositories.stats.noRecent', { months: STATS_MONTHS });
}

interface BlockProps {
  title: string;
  heading?: 'page' | 'section';
  children: ReactNode;
}

function Block({ title, heading = 'section', children }: BlockProps) {
  return (
    <section className={styles.block}>
      {heading === 'page' ? (
        <h2 className={styles.name}>{title}</h2>
      ) : (
        <h3 className={styles.blockTitle}>{title}</h3>
      )}
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{children}</dd>
    </div>
  );
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.count}>
      <dt className={styles.countLabel}>{label}</dt>
      <dd className={styles.countValue}>{value}</dd>
    </div>
  );
}

/**
 * Lo que le falta y lo que le sobra a la rama activa respecto de su remoto.
 *
 * Una rama sin `upstream` no está ni adelantada ni retrasada: no hay con qué
 * comparar, y decirlo es más útil que enseñar dos ceros. Los rótulos nombran la
 * rama y el remoto, que es la invariante 5 aplicada a un dato y no a una acción.
 */
function Divergence({ branch }: { branch: Branch }) {
  const { t } = useI18n();

  if (branch.upstream === undefined) {
    return <Badge>{t('repositories.stats.noUpstream', { branch: branch.name })}</Badge>;
  }

  return (
    <>
      {branch.ahead > 0 && (
        <Badge variant="info">
          {t('repositories.stats.ahead', { count: branch.ahead, remote: branch.upstream })}
        </Badge>
      )}
      {branch.behind > 0 && (
        <Badge variant="info">
          {t('repositories.stats.behind', { count: branch.behind, remote: branch.upstream })}
        </Badge>
      )}
    </>
  );
}
