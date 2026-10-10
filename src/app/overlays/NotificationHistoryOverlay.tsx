import { useEffect, useMemo } from 'react';

import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';
import { Dialog } from '@ui/Dialog';
import { IconButton } from '@ui/IconButton';
import { useToast } from '@ui/useToast';

import { useShellStore } from '../shellStore';
import styles from './NotificationHistoryOverlay.module.css';

function RemoveIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function NotificationHistoryOverlay() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { markHistoryRead } = toast;
  const overlay = useShellStore((state) => state.overlay);
  const setOverlay = useShellStore((state) => state.setOverlay);
  const open = overlay === 'notifications';
  const dates = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }),
    [locale],
  );

  useEffect(() => {
    if (open) markHistoryRead();
  }, [markHistoryRead, open]);

  return (
    <Dialog
      open={open}
      onClose={() => setOverlay('none')}
      title={t('notifications.title')}
      closeLabel={t('notifications.close')}
      footer={
        <Button disabled={toast.history.length === 0} onClick={toast.clearHistory}>
          {t('notifications.clear')}
        </Button>
      }
    >
      {toast.history.length === 0 ? (
        <p className={styles.empty}>{t('notifications.empty')}</p>
      ) : (
        <ol className={styles.list}>
          {[...toast.history].reverse().map((entry) => (
            <li className={styles.entry} key={entry.id} data-variant={entry.variant}>
              <div className={styles.copy}>
                <p className={styles.message}>{entry.message}</p>
                <time className={styles.time} dateTime={new Date(entry.createdAt).toISOString()}>
                  {dates.format(entry.createdAt)}
                </time>
              </div>
              <IconButton
                size="sm"
                icon={<RemoveIcon />}
                aria-label={t('notifications.remove')}
                onClick={() => toast.removeFromHistory(entry.id)}
              />
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
