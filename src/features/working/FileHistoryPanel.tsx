import { useCallback, useEffect, useMemo, useRef } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import type { Commit, Sha } from '@core/domain/commit';
import { shortSha } from '@core/domain/commit';
import type { RepoId } from '@core/domain/repository';
import type { GitQuery } from '@core/ports/GitPort';
import type { FileChange } from '@core/domain/status';
import { useI18n } from '@i18n/useI18n';
import { ContextMenu } from '@ui/ContextMenu';
import { EmptyState } from '@ui/EmptyState';
import { IconButton } from '@ui/IconButton';
import { Skeleton } from '@ui/Skeleton';
import type { MenuEntry } from '@ui/menuUtils';

import styles from './FileHistoryPanel.module.css';

interface FileHistoryPanelProps {
  repoId: RepoId;
  path: string;
  /** Versión desde la que se abrió el historial; se señala entre las tarjetas. */
  activeSha?: Sha;
  /** Al entrar desde búsqueda, abrir una sola vez la versión más reciente. */
  openLatest?: boolean;
  /** El menú del commit de la fila: el mismo que el de la tabla. */
  menuFor: (commit: Commit) => readonly MenuEntry[];
  /** Abre el diff de este archivo en ese commit — CU-19. */
  onOpenDiff: (sha: Sha) => void;
  onClose: () => void;
}

const SKELETON_ROWS = 8;

interface FileHistoryData {
  commits: readonly Commit[];
  activeChange: FileChange | null;
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

/**
 * El historial de un archivo — CU-19.
 *
 * Panel propio y no un filtro de la tabla principal: el grafo sigue contando la
 * historia del repositorio en el centro, y volver de aquí no debería costar
 * reconstruir el recorrido entero. Vive en el panel derecho para que la lista
 * permanezca operable mientras el diff ocupa el centro.
 *
 * Clic en una fila abre el diff de ese archivo en ese commit — CU-5. El visor se
 * pone en la columna central y esta lista permanece visible para saltar entre
 * versiones sin cerrar nada.
 */
export function FileHistoryPanel({
  repoId,
  path,
  activeSha,
  openLatest = false,
  menuFor,
  onOpenDiff,
  onClose,
}: FileHistoryPanelProps) {
  const { t, locale } = useI18n();
  const { git } = usePorts();

  const load = useCallback(
    async (query: GitQuery): Promise<FileHistoryData> => {
      const commits = await git.readFileHistory(repoId, path, query);
      const detailSha =
        activeSha && commits.some((commit) => commit.sha === activeSha)
          ? activeSha
          : commits[0]?.sha;

      if (!detailSha) return { commits, activeChange: null };

      const detail = await git.readCommit(repoId, detailSha, query);

      return {
        commits,
        activeChange: detail.files.find((file) => file.path === path) ?? null,
      };
    },
    [activeSha, git, path, repoId],
  );

  const data = useAsyncData(load, { resourceKey: `${repoId}:${path}` });
  // HEAD may not have changed this file. Select the same revision used by the
  // change summary, falling back to the newest commit in the file's history.
  const selectedSha =
    data.status === 'ready'
      ? (data.data.commits.find((commit) => commit.sha === activeSha)?.sha ??
        data.data.commits[0]?.sha)
      : undefined;

  const autoOpened = useRef(false);
  const latestSha = data.status === 'ready' ? data.data.commits[0]?.sha : undefined;
  useEffect(() => {
    if (!openLatest) {
      autoOpened.current = false;
      return;
    }
    if (!latestSha || autoOpened.current) return;
    autoOpened.current = true;
    // openDiff consumes openLatest and records the selected revision in history.
    onOpenDiff(latestSha);
  }, [latestSha, onOpenDiff, openLatest]);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );

  return (
    <section
      className={styles.panel}
      data-file-history
      aria-label={t('working.fileHistory.label', { path })}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{t('working.fileHistory.heading')}</h2>
        <IconButton
          icon={<CloseIcon />}
          aria-label={t('working.fileHistory.close', { path })}
          onClick={onClose}
        />
      </header>

      {data.status === 'ready' && (
        <div className={styles.fileSummary}>
          <strong className={styles.fileName}>{nameOf(path)}</strong>
          <span className={styles.filePath}>{path}</span>
          <dl className={styles.facts}>
            <div>
              <dt>{t('working.fileHistory.type')}</dt>
              <dd>{typeOf(path, data.data.activeChange, t)}</dd>
            </div>
            <div>
              <dt>{t('working.fileHistory.lastChange')}</dt>
              <dd>
                {data.data.commits[0]
                  ? dateFormat.format(data.data.commits[0].authoredAt)
                  : t('working.fileHistory.unknown')}
              </dd>
            </div>
            <div>
              <dt>{t('working.fileHistory.changes')}</dt>
              <dd>
                {data.data.activeChange
                  ? t('working.fileHistory.changeSummary', {
                      insertions: data.data.activeChange.insertions,
                      deletions: data.data.activeChange.deletions,
                    })
                  : t('working.fileHistory.unknown')}
              </dd>
            </div>
            <div>
              <dt>{t('working.fileHistory.versions')}</dt>
              <dd>{data.data.commits.length}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className={styles.body}>
        {data.status === 'loading' && (
          <div role="status" aria-label={t('working.fileHistory.loading', { path })}>
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <Skeleton key={index} variant="block" style={{ height: 'var(--row-height)' }} />
            ))}
          </div>
        )}

        {data.status === 'failed' && (
          <GitErrorPanel error={data.error} fixes={{ retry: data.reload }} />
        )}

        {data.status === 'ready' && data.data.commits.length === 0 && (
          <EmptyState
            size="sm"
            title={t('working.fileHistory.empty.title', { path })}
            description={t('working.fileHistory.empty.description')}
          />
        )}

        {data.status === 'ready' && data.data.commits.length > 0 && (
          <ul className={styles.list}>
            {data.data.commits.map((commit, index) => (
              <li
                key={commit.sha}
                className={styles.card}
                data-current={commit.sha === selectedSha ? '' : undefined}
              >
                <ContextMenu
                  items={menuFor(commit)}
                  label={t('working.menu.commit.label', { sha: shortSha(commit.sha) })}
                  className={styles.row}
                >
                  {/* La fila entera es el botón: lo que se pulsa es el commit,
                      no una de sus tres columnas. El menú contextual sigue
                      colgando de la región de fuera, que es quien lo escucha. */}
                  <button
                    type="button"
                    className={styles.open}
                    aria-current={commit.sha === selectedSha ? 'true' : undefined}
                    onClick={() => {
                      onOpenDiff(commit.sha);
                    }}
                  >
                    <span className={styles.summary}>{commit.summary}</span>
                    {commit.sha === selectedSha && (
                      <span className={styles.current}>{t('working.fileHistory.current')}</span>
                    )}
                    <span className={styles.meta}>
                      {commit.author.name} · {dateFormat.format(commit.authoredAt)}
                    </span>
                    <code className={styles.sha}>{shortSha(commit.sha)}</code>
                    <span className={styles.order}>
                      {index === 0
                        ? t('working.fileHistory.newest')
                        : index === data.data.commits.length - 1
                          ? t('working.fileHistory.oldest')
                          : ''}
                    </span>
                  </button>
                </ContextMenu>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function typeOf(
  path: string,
  change: FileChange | null,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (change?.binary) return t('working.fileHistory.typeBinary');
  const extension = nameOf(path).includes('.') ? nameOf(path).split('.').pop() : undefined;
  return extension
    ? t('working.fileHistory.typeExtension', { extension: extension?.toUpperCase() ?? '' })
    : t('working.fileHistory.typeText');
}
