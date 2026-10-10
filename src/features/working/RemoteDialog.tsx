import { useState } from 'react';

import type { Remote } from '@core/domain/refs';
import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { Input } from '@ui/Input';
import styles from './RemoteDialog.module.css';

interface RemoteDialogProps {
  remote?: Remote;
  taken: readonly string[];
  onConfirm: (remote: Remote, previous?: Remote) => void;
  onCancel: () => void;
}

function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function RemoteDialog({ remote, taken, onConfirm, onCancel }: RemoteDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(remote?.name ?? '');
  const [fetchUrl, setFetchUrl] = useState(remote?.fetchUrl ?? '');
  const [pushUrl, setPushUrl] = useState(remote?.pushUrl ?? '');
  const [pushEdited, setPushEdited] = useState(remote !== undefined);
  const trimmedName = name.trim();
  const invalidName =
    trimmedName.length === 0 ||
    /[\s~^:?*[\]\\]/.test(trimmedName) ||
    hasControl(trimmedName) ||
    trimmedName.includes('..') ||
    trimmedName.endsWith('.');
  const repeated = taken.some(
    (candidate) => candidate === trimmedName && candidate !== remote?.name,
  );
  const invalidUrl = [fetchUrl, pushUrl].some((url) => url.trim().length === 0 || hasControl(url));
  const problem = invalidName || repeated || invalidUrl;

  const confirm = () => {
    if (problem) return;
    onConfirm({ name: trimmedName, fetchUrl: fetchUrl.trim(), pushUrl: pushUrl.trim() }, remote);
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      size="lg"
      title={
        remote
          ? t('working.dialog.remote.editTitle', { remote: remote.name })
          : t('working.dialog.remote.addTitle')
      }
      closeLabel={t('working.dialog.close')}
      footer={
        <>
          <Button onClick={onCancel}>{t('working.dialog.cancel')}</Button>
          <Button variant="primary" disabled={problem} onClick={confirm}>
            {remote
              ? t('working.dialog.remote.saveConfirm')
              : t('working.dialog.remote.addConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Input
          autoFocus
          label={t('working.dialog.remote.nameLabel')}
          value={name}
          error={
            repeated
              ? t('working.dialog.remote.nameTaken', { remote: trimmedName })
              : invalidName && name.length > 0
                ? t('working.dialog.remote.nameInvalid')
                : undefined
          }
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Input
          label={t('working.dialog.remote.fetchUrlLabel')}
          value={fetchUrl}
          onChange={(event) => {
            const value = event.target.value;
            setFetchUrl(value);
            if (!pushEdited) setPushUrl(value);
          }}
        />
        <Input
          label={t('working.dialog.remote.pushUrlLabel')}
          value={pushUrl}
          onChange={(event) => {
            setPushEdited(true);
            setPushUrl(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            confirm();
          }}
        />
      </div>
    </Dialog>
  );
}
