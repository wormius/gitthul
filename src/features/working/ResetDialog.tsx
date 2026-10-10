import { useState } from 'react';

import type { Sha } from '@core/domain/commit';
import { shortSha } from '@core/domain/commit';
import type { ResetMode } from '@core/domain/refs';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Spinner } from '@ui/Spinner';
import styles from './ResetDialog.module.css';
import { SegmentedControl } from '@ui/SegmentedControl';

interface ResetDialogProps {
  busy?: boolean;
  branch: string;
  sha: Sha;
  /** Modo inicial del diálogo. */
  initialMode: ResetMode;
  /** Cuántos archivos tocados se llevaría por delante el modo duro. */
  dirtyFiles: number;
  onConfirm: (sha: Sha, mode: ResetMode) => void;
  onCancel: () => void;
}

/** El modo se elige aquí; el diálogo permanece abierto durante la escritura. */
export function ResetDialog({
  busy = false,
  branch,
  sha,
  initialMode,
  dirtyFiles,
  onConfirm,
  onCancel,
}: ResetDialogProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<ResetMode>(initialMode);
  const short = shortSha(sha);

  const description =
    mode === 'hard'
      ? t('working.dialog.reset.hardWarning', { branch, sha: short, files: dirtyFiles })
      : mode === 'mixed'
        ? t('working.dialog.reset.mixedWarning', { branch, sha: short })
        : t('working.dialog.reset.softWarning', { branch, sha: short });

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onCancel();
      }}
      size="md"
      title={t('working.dialog.reset.title', { branch, sha: short })}
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              onConfirm(sha, mode);
            }}
          >
            {t('working.dialog.reset.confirm')}
          </Button>
          <Button disabled={busy} onClick={onCancel}>
            {t('working.dialog.cancel')}
          </Button>
        </>
      }
    >
      {busy && (
        <p className={styles.progress}>
          <Spinner label={t('working.busy')} />
          {t('working.busy')}
        </p>
      )}
      <fieldset className={styles.fieldset} disabled={busy} aria-busy={busy}>
        <SegmentedControl<ResetMode>
          className={styles.modes}
          label={t('working.dialog.reset.modeLabel')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'soft', label: t('working.dialog.reset.soft') },
            { value: 'mixed', label: t('working.dialog.reset.mixed') },
            { value: 'hard', label: t('working.dialog.reset.hard') },
          ]}
        />
      </fieldset>
      <p className={styles.description}>{description}</p>
    </Dialog>
  );
}
