import { useCallback, useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { useAsyncData } from '@app/useAsyncData';
import { usePorts } from '@app/PortsContext';
import type { Commit, Sha } from '@core/domain/commit';
import { isMerge, shortSha } from '@core/domain/commit';
import type { CommitSequencePrecondition } from '@core/domain/commit';
import type { RepoId } from '@core/domain/repository';
import type { GitQuery } from '@core/ports/GitPort';
import { useI18n } from '@i18n/useI18n';
import { Banner } from '@ui/Banner';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Radio } from '@ui/Radio';
import { Spinner } from '@ui/Spinner';

import styles from './CommitSequenceDialog.module.css';

interface SequenceDetails {
  commits: readonly Commit[];
  parents: readonly Commit[];
}

interface CommitSequenceDialogProps {
  kind: 'cherryPick' | 'revert';
  repoId: RepoId;
  branch: string;
  shas: readonly Sha[];
  contiguous: boolean;
  precondition: CommitSequencePrecondition;
  onConfirm: (
    shas: readonly Sha[],
    precondition: CommitSequencePrecondition,
    mainline?: number,
  ) => void;
  onCancel: () => void;
}

/** Confirmación de cherry-pick/revert, incluida la línea principal de un merge. */
export function CommitSequenceDialog({
  kind,
  repoId,
  branch,
  shas,
  contiguous,
  precondition,
  onConfirm,
  onCancel,
}: CommitSequenceDialogProps) {
  const { t } = useI18n();
  const { git } = usePorts();
  const [mainline, setMainline] = useState<number | null>(null);

  const load = useCallback(
    async (query: GitQuery): Promise<SequenceDetails> => {
      const commits = await Promise.all(
        shas.map(async (sha) => (await git.readCommit(repoId, sha, query)).commit),
      );
      const selected = commits.length === 1 ? commits[0] : undefined;
      const parents =
        selected !== undefined && isMerge(selected)
          ? await Promise.all(
              selected.parents.map(
                async (sha) => (await git.readCommit(repoId, sha, query)).commit,
              ),
            )
          : [];

      return { commits, parents };
    },
    [git, repoId, shas],
  );

  const details = useAsyncData(load);
  const count = shas.length;
  const title = t(`working.dialog.${kind}.title`, { count, branch });
  const description = t(`working.dialog.${kind}.description`, { count, branch });
  const confirmLabel = t(`working.dialog.${kind}.confirm`, { count, branch });
  const containsMerge =
    details.status === 'ready' && details.data.commits.some((commit) => isMerge(commit));
  const merge =
    details.status === 'ready' && details.data.commits.length === 1
      ? details.data.commits.find((commit) => isMerge(commit))
      : undefined;
  const unsupportedSequence = containsMerge && count > 1;
  const canConfirm =
    details.status === 'ready' &&
    !unsupportedSequence &&
    (merge === undefined || mainline !== null);

  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={title}
      description={description}
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button onClick={onCancel}>{t('working.dialog.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!canConfirm}
            onClick={() => {
              if (!canConfirm) return;
              onConfirm(shas, precondition, mainline ?? undefined);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {!contiguous && <p className={styles.note}>{t('working.dialog.notContiguous')}</p>}

      {details.status === 'loading' && (
        <div className={styles.loading}>
          <Spinner size="sm" label={t('working.dialog.mainline.loading')} />
          <span>{t('working.dialog.mainline.loading')}</span>
        </div>
      )}

      {details.status === 'failed' && (
        <GitErrorPanel error={details.error} fixes={{ retry: details.reload }} />
      )}

      {details.status === 'ready' && unsupportedSequence && (
        <Banner variant="warning" title={t('working.dialog.mainline.sequenceTitle')}>
          {t('working.dialog.mainline.sequenceDescription')}
        </Banner>
      )}

      {details.status === 'ready' && merge !== undefined && !unsupportedSequence && (
        <fieldset className={styles.choice}>
          <legend>{t('working.dialog.mainline.legend', { sha: shortSha(merge.sha) })}</legend>
          <p>{t('working.dialog.mainline.description')}</p>
          <div className={styles.parents}>
            {details.data.parents.map((parent, index) => {
              const number = index + 1;

              return (
                <Radio
                  key={parent.sha}
                  name="mainline"
                  value={number}
                  checked={mainline === number}
                  label={t('working.dialog.mainline.parent', {
                    number,
                    sha: shortSha(parent.sha),
                    summary: parent.summary,
                  })}
                  onChange={() => {
                    setMainline(number);
                  }}
                />
              );
            })}
          </div>
        </fieldset>
      )}
    </Dialog>
  );
}
