import { useI18n } from '@i18n/useI18n';
import { Button } from '@ui/Button';

import styles from './PushRejectedPanel.module.css';
import type { PushRejectedInfo } from './workingStore';

interface PushRejectedPanelProps {
  info: PushRejectedInfo;
  onPullAndRetry: () => void;
  onForce: () => void;
  onCancel: () => void;
}

/**
 * Modal que aparece cuando un push es rechazado por el remoto — F2.9.
 *
 * Nombra la rama explícitamente (invariante 5) y ofrece tres salidas: traer y
 * reintentar, forzar, o cancelar.
 */
export function PushRejectedPanel({
  info,
  onPullAndRetry,
  onForce,
  onCancel,
}: PushRejectedPanelProps) {
  const { t } = useI18n();

  return (
    <div className={styles.backdrop} onClick={onCancel} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('working.pushRejected.title', { branch: info.branch })}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <h2 className={styles.title}>{t('working.pushRejected.title', { branch: info.branch })}</h2>

        <p className={styles.description}>{t('working.pushRejected.description')}</p>

        <div className={styles.buttons}>
          <Button variant="primary" onClick={onPullAndRetry}>
            {t('working.pushRejected.pullAndRetry')}
          </Button>
          <Button variant="secondary" onClick={onForce}>
            {t('working.pushRejected.force')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('working.pushRejected.cancel')}
          </Button>
        </div>

        <p className={styles.warning}>{t('working.pushRejected.forceWarning')}</p>
      </div>
    </div>
  );
}
