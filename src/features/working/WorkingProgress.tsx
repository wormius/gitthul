import { useState } from 'react';

import type { TransferProgress } from '@core/domain/repository';
import { useI18n } from '@i18n/useI18n';
import type { MessageKey } from '@i18n/messages';
import { IconButton } from '@ui/IconButton';
import { ProgressBar } from '@ui/ProgressBar';
import { useGestures } from '@app/GestureContext';

import { useWorkingStore } from './workingStore';
import styles from './WorkingProgress.module.css';

const PROGRESS_KEY: Record<TransferProgress['phase'], MessageKey> = {
  counting: 'clone.phase.counting',
  compressing: 'network.phase.compressing',
  sending: 'network.phase.sending',
  receiving: 'clone.phase.receiving',
  resolving: 'clone.phase.resolving',
  checkout: 'clone.phase.checkout',
};

function CancelIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** Un único indicador para escrituras bloqueantes y transferencias no bloqueantes. */
export function WorkingProgress() {
  const { t } = useI18n();
  const gestures = useGestures();
  const pending = useWorkingStore((state) => state.pendingWrites);
  const progress = useWorkingStore((state) => state.networkProgress);
  const active = pending > 0 || progress !== null;
  const [display, setDisplay] = useState({ active, progress });

  // Conserva el porcentaje y el alto de la fila mientras se pliega al terminar.
  if (active !== display.active || (progress !== null && progress !== display.progress)) {
    setDisplay({
      active,
      progress: active && !display.active ? progress : (progress ?? display.progress),
    });
  }
  const displayedProgress = display.progress;

  const label =
    displayedProgress === null ? t('working.busy') : t(PROGRESS_KEY[displayedProgress.phase]);
  const value =
    displayedProgress?.total && displayedProgress.total > 0
      ? (displayedProgress.received / displayedProgress.total) * 100
      : undefined;

  return (
    <div
      className={[styles.presence, active ? styles.active : ''].filter(Boolean).join(' ')}
      aria-hidden={!active}
      inert={!active}
    >
      <div className={styles.clip}>
        <div className={styles.panel} role="status" aria-label={label} aria-live="polite">
          <ProgressBar className={styles.bar} label={label} value={value} />
          {progress !== null ? (
            <IconButton
              icon={<CancelIcon />}
              size="sm"
              autoFocus
              aria-label={t('gesture.working.cancelNetwork')}
              onClick={() => gestures.run('working.cancelNetwork')}
            />
          ) : displayedProgress !== null ? (
            <span className={styles.cancelSpace} aria-hidden="true" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
