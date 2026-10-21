import { useRef, type KeyboardEvent } from 'react';

import { TOAST_POSITIONS, type ToastPosition } from '@design/theme';
import { useI18n } from '@i18n/useI18n';

import styles from './ToastPositionPicker.module.css';

interface ToastPositionPickerProps {
  value: ToastPosition;
  onChange: (position: ToastPosition) => void;
}

/** Las cuatro esquinas pertenecen a una misma ventana de referencia. */
export function ToastPositionPicker({ value, onChange }: ToastPositionPickerProps) {
  const { t } = useI18n();
  const buttons = useRef(new Map<ToastPosition, HTMLButtonElement>());

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, position: ToastPosition) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const index = TOAST_POSITIONS.indexOf(position);
    let next: number;

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        next = index ^ 1;
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        next = index ^ 2;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = TOAST_POSITIONS.length - 1;
        break;
      default:
        return;
    }

    const target = TOAST_POSITIONS[next];
    if (!target) return;

    event.preventDefault();
    event.stopPropagation();
    buttons.current.get(target)?.focus();
    onChange(target);
  };

  return (
    <div
      className={styles.window}
      role="radiogroup"
      aria-label={t('settings.appearance.toastPosition')}
    >
      <div className={styles.titleBar} aria-hidden="true">
        <span className={styles.windowTitle} />
        <span className={styles.windowControls}>
          <span />
          <span />
          <span />
        </span>
      </div>
      <div className={styles.viewport}>
        <div className={styles.content} aria-hidden="true">
          <span className={styles.sidebar} />
          <span className={styles.document}>
            <span />
            <span />
            <span />
          </span>
        </div>
        {TOAST_POSITIONS.map((position) => {
          const label = t(`settings.appearance.toastPosition.${position}`);

          return (
            <button
              key={position}
              ref={(node) => {
                if (node) buttons.current.set(position, node);
                else buttons.current.delete(position);
              }}
              type="button"
              role="radio"
              aria-label={label}
              aria-checked={value === position}
              tabIndex={value === position ? 0 : -1}
              className={styles.corner}
              data-position={position}
              onClick={() => onChange(position)}
              onKeyDown={(event) => navigate(event, position)}
            >
              <span className={styles.notification} aria-hidden="true">
                <span className={styles.notificationIcon} />
                <span className={styles.lines}>
                  <span />
                  <span />
                </span>
                <span className={styles.check}>
                  <svg viewBox="0 0 16 16" fill="none">
                    <path
                      d="m4 8 2.5 2.5L12 5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </span>
              <span className={styles.label}>{label}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.bottomBar} aria-hidden="true">
        <span />
        <span />
      </div>
    </div>
  );
}
