import { useCallback, useMemo, useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import type { Sha } from '@core/domain/commit';
import { shortSha } from '@core/domain/commit';
import type { DiffSource } from '@core/domain/diff';
import type { RepoId } from '@core/domain/repository';
import type { GitQuery } from '@core/ports/GitPort';
import { useI18n } from '@i18n/useI18n';
import { Avatar } from '@ui/Avatar';
import { Button } from '@ui/Button';
import { Badge } from '@ui/Badge';
import { Skeleton } from '@ui/Skeleton';
import { Spinner } from '@ui/Spinner';

import styles from './CommitDetails.module.css';
import { commitFileMenu, type MenuBuildContext } from './contextMenus';
import { FileList, type FileMenuTarget } from './FileList';
import { FileListToolbar } from './FileListToolbar';
import type { RowMenu } from './CommitRow';
import { mergeTreeWithChanges, visibleFiles } from './staging';
import { useWorkingStore } from './workingStore';

interface CommitDetailsProps {
  repoId: RepoId;
  sha: Sha;
  sourceKind?: 'commit' | 'stash';
  menuContext: MenuBuildContext;
  /** Los guardados son instantáneas auxiliares, no commits del historial. */
  showChangeDetails?: boolean;
  canAmend?: boolean;
  allowAllFiles?: boolean;
}

const SKELETON_ROWS = 6;
const NOTHING: ReadonlySet<string> = new Set();

/**
 * Lo que enseña el panel derecho con un commit marcado — CU-4.
 *
 * Se pide con `readCommit` y **se cancela al cambiar de selección**: recorrer el
 * historial con las flechas deja peticiones abortadas y ningún panel de error,
 * que es lo que `useAsyncData` ya hace al cambiar de `load`.
 *
 * Clic en un archivo abre su diff en este commit — CU-5.
 */
export function CommitDetails({
  repoId,
  sha,
  sourceKind = 'commit',
  menuContext,
  showChangeDetails = true,
  canAmend = false,
  allowAllFiles = true,
}: CommitDetailsProps) {
  const { t, locale } = useI18n();
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
  const [showAllFiles, setShowAllFiles] = useState(false);
  const browseTree = allowAllFiles && view === 'tree' && showAllFiles;
  const loadTree = useCallback(
    (query: GitQuery) => (browseTree ? git.readTree(repoId, sha, query) : Promise.resolve([])),
    [browseTree, git, repoId, sha],
  );
  const tree = useAsyncData(loadTree);

  const load = useCallback(
    (query: GitQuery) => git.readCommit(repoId, sha, query),
    [git, repoId, sha],
  );

  const data = useAsyncData(load);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }),
    [locale],
  );

  // El origen es este commit: lo que enseña el visor es qué le hizo al archivo,
  // no cómo está el archivo ahora — CU-5.
  const source = useMemo<DiffSource>(() => ({ kind: sourceKind, sha }), [sha, sourceKind]);

  const menuFor = useCallback(
    (target: FileMenuTarget): RowMenu =>
      target.kind === 'folder'
        ? { items: [], label: t('working.menu.folder.label', { folder: target.path }) }
        : {
            items: commitFileMenu(menuContext, target.file.path, source),
            label: t('working.menu.file.label', { path: target.file.path }),
          },
    [menuContext, source, t],
  );

  const open = useCallback(
    (path: string) => {
      menuContext.actions.openDiff(path, source);
    },
    [menuContext, source],
  );

  if (data.status === 'loading') {
    return (
      <div
        className={styles.panel}
        role="status"
        aria-label={t('working.commitDetails.loading', { sha: shortSha(sha) })}
      >
        <div className={styles.skeleton}>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} variant="block" style={{ height: 'var(--row-height)' }} />
          ))}
        </div>
      </div>
    );
  }

  if (data.status === 'failed') {
    return (
      <div className={styles.panel}>
        <div className={styles.error}>
          <GitErrorPanel error={data.error} fixes={{ retry: data.reload }} />
        </div>
      </div>
    );
  }

  const { commit, files, refs } = data.data;
  const listedFiles =
    browseTree && tree.status === 'ready' ? mergeTreeWithChanges(tree.data, files) : files;
  const matches = visibleFiles(listedFiles, filter, sort).length;

  return (
    <section
      className={styles.panel}
      aria-label={t('working.commitDetails.label', { sha: shortSha(commit.sha) })}
    >
      <header className={styles.header}>
        <h2 className={styles.summary}>{commit.summary}</h2>
        {commit.body !== '' && <p className={styles.body}>{commit.body}</p>}

        <div className={styles.author}>
          <Avatar name={commit.author.name} email={commit.author.email} size="xs" />
          <div className={styles.authorText}>
            <span className={styles.name}>{commit.author.name}</span>
            <span className={styles.email}>{commit.author.email}</span>
            <span className={styles.date}>
              {t('working.commitDetails.authoredAt')}: {dateFormat.format(commit.authoredAt)}
            </span>
            <span className={styles.date}>
              {t('working.commitDetails.committedAt')}: {dateFormat.format(commit.committedAt)}
            </span>
            {(commit.author.name !== commit.committer.name ||
              commit.author.email !== commit.committer.email) && (
              <span className={styles.email}>
                {t('working.commitDetails.committer')}: {commit.committer.name} &lt;
                {commit.committer.email}&gt;
              </span>
            )}
          </div>
        </div>

        <div className={styles.meta}>
          <code className={styles.sha} title={commit.sha}>
            {shortSha(commit.sha, 10)}
          </code>
          {refs.map((name) => (
            <Badge key={name}>{name}</Badge>
          ))}
        </div>
        {canAmend && (
          <Button onClick={() => useWorkingStore.getState().requestCommit(true)}>
            {t('working.composer.amend')}
          </Button>
        )}
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
        focusRequest={filterFocus}
        showAllFiles={allowAllFiles ? showAllFiles : undefined}
        onShowAllFilesChange={allowAllFiles ? setShowAllFiles : undefined}
      />

      {browseTree && tree.status === 'loading' && (
        <Spinner label={t('working.commitDetails.loading', { sha: shortSha(sha) })} />
      )}
      {browseTree && tree.status === 'failed' && (
        <div className={styles.error}>
          <GitErrorPanel error={tree.error} fixes={{ retry: tree.reload }} />
        </div>
      )}
      <FileList
        label={t('working.commitDetails.files', { sha: shortSha(commit.sha) })}
        files={listedFiles}
        view={view}
        sort={sort}
        filter={filter}
        selected={selected}
        onSelectedChange={setSelected}
        menuFor={menuFor}
        onOpen={open}
        empty={t('working.commitDetails.empty')}
        showChangeDetails={showChangeDetails}
        treeExpanded={treeExpanded}
      />
    </section>
  );
}
