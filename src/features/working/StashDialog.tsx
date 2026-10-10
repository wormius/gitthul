import { useCallback, useState, type ChangeEvent } from 'react';

import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Checkbox } from '@ui/Checkbox';
import { Input } from '@ui/Input';

import styles from './StashDialog.module.css';

interface StashDialogProps {
  branch: string;
  onConfirm: (message: string, includeUntracked: boolean) => void;
  onCancel: () => void;
}

/**
 * Diálogo para guardar los cambios en un stash — F2.8.
 *
 * Pide un mensaje (prepopulado con «WIP en {branch}») y si incluir archivos sin
 * seguimiento. Los dos botones nombran la acción explícitamente, como exige la
 * invariante 5.
 */
export function StashDialog({ branch, onConfirm, onCancel }: StashDialogProps) {
  const { t } = useI18n();
  const [message, setMessage] = useState(t('working.stashDialog.message', { branch }));
  const [includeUntracked, setIncludeUntracked] = useState(false);

  const handleConfirm = useCallback(() => {
    onConfirm(message.trim() || t('working.stashDialog.message', { branch }), includeUntracked);
  }, [onConfirm, message, branch, includeUntracked, t]);

  const handleMessageChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setMessage(event.target.value);
  }, []);

  const handleUntrackedChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setIncludeUntracked(event.target.checked);
  }, []);

  return (
    <div className={styles.backdrop} onClick={onCancel} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('working.stashDialog.title')}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 className={styles.title}>{t('working.stashDialog.title')}</h2>

        <div className={styles.fields}>
          <Input
            label={t('working.stashDialog.title')}
            value={message}
            onChange={handleMessageChange}
            autoFocus
          />
          <Checkbox
            label={t('working.stashDialog.includeUntracked')}
            checked={includeUntracked}
            onChange={handleUntrackedChange}
          />
        </div>

        <div className={styles.buttons}>
          <Button variant="primary" onClick={handleConfirm}>
            {t('working.stashDialog.confirm')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('working.stashDialog.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
