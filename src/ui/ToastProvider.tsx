import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from './Button';
import type { ToastPosition } from '@core/domain/settings';
import { IconButton } from './IconButton';
import {
  DEFAULT_TOAST_DURATION,
  DANGER_TOAST_DURATION,
  ToastContext,
  WARNING_TOAST_DURATION,
  type ToastApi,
  type ToastHistoryRecord,
  type ToastOptions,
  type ToastRecord,
} from './toastContext';
import styles from './ToastProvider.module.css';

interface ToastProviderProps {
  /** Nombre accesible de la región de avisos. */
  regionLabel: string;
  /** Etiqueta accesible del botón de cerrar de cada aviso. */
  dismissLabel: string;
  position?: ToastPosition;
  children: ReactNode;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ToastIcon({ variant }: { variant: ToastRecord['variant'] }) {
  if (variant === 'success') {
    return (
      <svg viewBox="0 0 20 20">
        <path d="m4 10 4 4 8-9" />
      </svg>
    );
  }
  if (variant === 'warning') {
    return (
      <svg viewBox="0 0 20 20">
        <path d="M10 3 18 17H2L10 3Zm0 5v4m0 2.5v.5" />
      </svg>
    );
  }
  if (variant === 'danger') {
    return (
      <svg viewBox="0 0 20 20">
        <path d="M5 5l10 10M15 5 5 15" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20">
      <path d="M10 9v6m0-10v1" />
      <circle cx="10" cy="10" r="8" />
    </svg>
  );
}

interface ActiveTimer {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

/**
 * Región de avisos y la API para lanzarlos.
 *
 * Los avisos son la otra mitad de la invariante 2: lo que no se confirma antes
 * se deshace después, y el botón de deshacer vive aquí. Por eso el temporizador
 * se detiene mientras el puntero está encima — que se escape el deshacer por no
 * llegar a tiempo sería exactamente el fallo que la invariante quiere evitar.
 */
export function ToastProvider({
  regionLabel,
  dismissLabel,
  position = 'top-end',
  children,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const [history, setHistory] = useState<readonly ToastHistoryRecord[]>([]);
  const timers = useRef(new Map<string, ActiveTimer>());
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);

    if (timer?.handle) clearTimeout(timer.handle);

    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
    setHeld((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const start = useCallback(
    (id: string, duration: number) => {
      if (duration <= 0) return;

      const handle = setTimeout(() => {
        dismiss(id);
      }, duration);
      timers.current.set(id, { handle, remaining: duration, startedAt: Date.now() });
    },
    [dismiss],
  );

  const durationFor = useCallback((toast: ToastRecord) => {
    if (toast.duration !== undefined) return toast.duration;
    if (toast.variant === 'danger') return DANGER_TOAST_DURATION;
    if (toast.variant === 'warning') return WARNING_TOAST_DURATION;
    return DEFAULT_TOAST_DURATION;
  }, []);

  const show = useCallback((options: ToastOptions) => {
    counter.current += 1;

    const id = `toast-${String(counter.current)}`;

    const createdAt = Date.now();
    const variant = options.variant ?? 'info';
    setToasts((current) => [...current, { ...options, id, createdAt }]);
    setHistory((current) => [
      ...current.slice(-99),
      { id, message: options.message, variant, createdAt, read: false },
    ]);

    return id;
  }, []);

  const markHistoryRead = useCallback(() => {
    setHistory((current) =>
      current.some((entry) => !entry.read)
        ? current.map((entry) => ({ ...entry, read: true }))
        : current,
    );
  }, []);
  const removeFromHistory = useCallback((id: string) => {
    setHistory((current) => current.filter((entry) => entry.id !== id));
  }, []);
  const clearHistory = useCallback(() => setHistory([]), []);
  const unread = history.filter((entry) => !entry.read).length;
  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      history,
      unread,
      markHistoryRead,
      removeFromHistory,
      clearHistory,
    }),
    [clearHistory, dismiss, history, markHistoryRead, removeFromHistory, show, unread],
  );

  const hold = useCallback((id: string) => {
    const timer = timers.current.get(id);

    if (timer?.handle) {
      clearTimeout(timer.handle);
      timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
      timer.handle = null;
    }
    setHeld((current) => new Set(current).add(id));
  }, []);

  const release = useCallback(
    (toast: ToastRecord) => {
      const timer = timers.current.get(toast.id);
      setHeld((current) => {
        const next = new Set(current);
        next.delete(toast.id);
        return next;
      });
      if (timer?.handle === null) start(toast.id, timer.remaining);
      else if (!timer) start(toast.id, durationFor(toast));
    },
    [durationFor, start],
  );

  const active = toasts.slice(0, 3);
  useEffect(() => {
    for (const toast of active) {
      if (!timers.current.has(toast.id)) start(toast.id, durationFor(toast));
    }
  }, [active, durationFor, start]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) {
        if (timer.handle) clearTimeout(timer.handle);
      }
      timers.current.clear();
    },
    [],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          className={styles.region}
          data-position={position}
          role="region"
          aria-label={regionLabel}
        >
          {active.map((toast) => (
            <div
              key={toast.id}
              className={[styles.toast, styles[toast.variant ?? 'info']].join(' ')}
              role={toast.variant === 'danger' ? 'alert' : 'status'}
              onMouseEnter={() => {
                hold(toast.id);
              }}
              onFocus={() => {
                hold(toast.id);
              }}
              onMouseLeave={() => {
                release(toast);
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) release(toast);
              }}
            >
              <span className={styles.variantIcon} aria-hidden="true">
                <ToastIcon variant={toast.variant ?? 'info'} />
              </span>
              <p className={styles.message}>{toast.message}</p>
              {toast.action && (
                <Button
                  size="sm"
                  variant="ghost"
                  className={styles.action}
                  onClick={() => {
                    toast.action?.onAction();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </Button>
              )}
              <IconButton
                icon={<CloseIcon />}
                size="sm"
                aria-label={dismissLabel}
                onClick={() => {
                  dismiss(toast.id);
                }}
              />
              <span
                className={styles.lifetime}
                aria-hidden="true"
                style={
                  {
                    '--toast-duration': `${String(durationFor(toast))}ms`,
                    animationPlayState: held.has(toast.id) ? 'paused' : 'running',
                  } as CSSProperties
                }
              />
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
