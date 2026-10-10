import { useCallback, useMemo, useState } from 'react';

import { GitErrorPanel } from '@app/GitErrorPanel';
import { usePorts } from '@app/PortsContext';
import { useAsyncData } from '@app/useAsyncData';
import { shortSha } from '@core/domain/commit';
import type { ReflogEntry, RepoId } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';
import { Select } from '@ui/Select';

import { validateRefName } from './branchNames';
import styles from './RecoveryDialog.module.css';

interface RecoveryDialogProps {
  repoId: RepoId;
  taken: readonly string[];
  onConfirm: (name: string, entry: ReflogEntry) => void;
  onCancel: () => void;
}

/** Recupera una posición anterior creando una rama nueva; nunca mueve HEAD. */
export function RecoveryDialog({ repoId, taken, onConfirm, onCancel }: RecoveryDialogProps) {
  const { git } = usePorts();
  const { locale, t } = useI18n();
  const [name, setName] = useState('recuperacion');
  const [selector, setSelector] = useState('');
  const load = useCallback(
    (query: { signal?: AbortSignal }) => git.readReflog(repoId, query),
    [git, repoId],
  );
  const result = useAsyncData(load);
  const dates = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );
  const entries = result.status === 'ready' ? result.data : [];
  const effectiveSelector = selector || entries[0]?.selector || '';
  const selected = entries.find((entry) => entry.selector === effectiveSelector);
  const problem = validateRefName(name, taken);
  const message =
    problem === 'taken'
      ? t('working.dialog.branch.taken', { branch: name.trim() })
      : problem === 'invalid'
        ? t('working.dialog.branch.invalid')
        : undefined;

  const confirm = () => {
    if (problem === null && selected) onConfirm(name.trim(), selected);
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="md"
      title={t('working.dialog.recovery.title')}
      description={t('working.dialog.recovery.description')}
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button onClick={onCancel}>{t('working.dialog.cancel')}</Button>
          <Button variant="primary" disabled={problem !== null || !selected} onClick={confirm}>
            {t('working.dialog.recovery.confirm')}
          </Button>
        </>
      }
    >
      {result.status === 'loading' && (
        <p className={styles.state}>{t('working.dialog.recovery.loading')}</p>
      )}
      {result.status === 'failed' && <GitErrorPanel error={result.error} />}
      {result.status === 'ready' && entries.length === 0 && (
        <p className={styles.state}>{t('working.dialog.recovery.empty')}</p>
      )}
      {entries.length > 0 && (
        <>
          <Select
            autoFocus
            label={t('working.dialog.recovery.pointLabel')}
            value={effectiveSelector}
            options={entries.map((entry) => ({
              value: entry.selector,
              label: `${dates.format(entry.at)} · ${shortSha(entry.sha)} · ${entry.summary}`,
            }))}
            onChange={(event) => {
              setSelector(event.target.value);
            }}
          />
          {selected && (
            <div className={styles.detail}>
              <strong>{shortSha(selected.sha)}</strong>
              <span>{selected.summary}</span>
            </div>
          )}
          <Input
            label={t('working.dialog.recovery.nameLabel')}
            value={name}
            error={message}
            hint={t('working.dialog.recovery.nameHint')}
            onChange={(event) => {
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              confirm();
            }}
          />
        </>
      )}
    </Dialog>
  );
}
