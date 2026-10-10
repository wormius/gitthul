import { useState } from 'react';

import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Select } from '@ui/Select';

interface PublishBranchDialogProps {
  branch: string;
  remotes: readonly string[];
  onConfirm: (remote: string) => void;
  onCancel: () => void;
}

/** Elige de forma explícita el remoto que será upstream de una rama solo local. */
export function PublishBranchDialog({
  branch,
  remotes,
  onConfirm,
  onCancel,
}: PublishBranchDialogProps) {
  const { t } = useI18n();
  const [remote, setRemote] = useState(remotes[0] ?? '');
  const hasRemote = remote.length > 0;

  return (
    <Dialog
      open
      onClose={onCancel}
      size="sm"
      title={t('working.dialog.publish.title', { branch })}
      description={
        remotes.length > 0
          ? t('working.dialog.publish.description', { branch })
          : t('working.dialog.publish.noRemotes')
      }
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button onClick={onCancel}>{t('working.dialog.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!hasRemote}
            onClick={() => {
              if (hasRemote) onConfirm(remote);
            }}
          >
            {t('working.dialog.publish.confirm', { branch })}
          </Button>
        </>
      }
    >
      {remotes.length > 0 && (
        <Select
          autoFocus
          label={t('working.dialog.publish.remoteLabel')}
          value={remote}
          options={remotes.map((name) => ({ value: name, label: name }))}
          onChange={(event) => {
            setRemote(event.target.value);
          }}
        />
      )}
    </Dialog>
  );
}
