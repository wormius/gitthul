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
  type ToastAction,
  type ToastDismissReason,
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
  const records = useRef(new Map<string, ToastRecord>());
  const pendingActions = useRef(new Set<string>());
  const hovered = useRef(new Set<string>());
  const focused = useRef(new Set<string>());
  const restoreFocus = useRef(new Map<string, HTMLButtonElement>());
  const mounted = useRef(true);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const counter = useRef(0);

  const removeToast = useCallback((id: string, reason: ToastDismissReason) => {
    const record = records.current.get(id);
    if (!record || (reason === 'timeout' && pendingActions.current.has(id))) return;
    records.current.delete(id);
    pendingActions.current.delete(id);
    hovered.current.delete(id);
    focused.current.delete(id);
    restoreFocus.current.delete(id);
    const timer = timers.current.get(id);

    if (timer?.handle) clearTimeout(timer.handle);

    timers.current.delete(id);
    setBusy((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setToasts((current) => current.filter((toast) => toast.id !== id));
    setHeld((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    try {
      // Callbacks belong to the caller; rejection must not break the toast region.
      void Promise.resolve(record.onDismiss?.(reason)).catch(() => undefined);
    } catch {
      // The notification was already removed even if its callback failed.
    }
  }, []);

  const dismiss = useCallback((id: string) => removeToast(id, 'programmatic'), [removeToast]);

  const start = useCallback(
    (id: string, duration: number) => {
      if (duration <= 0) return;

      const handle = setTimeout(() => {
        removeToast(id, 'timeout');
      }, duration);
      timers.current.set(id, { handle, remaining: duration, startedAt: Date.now() });
    },
    [removeToast],
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
    const record = { ...options, id, createdAt };
    records.current.set(id, record);
    setToasts((current) => [...current, record]);
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
      if (
        !records.current.has(toast.id) ||
        pendingActions.current.has(toast.id) ||
        hovered.current.has(toast.id) ||
        focused.current.has(toast.id)
      )
        return;
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

  const choose = useCallback(
    (toast: ToastRecord, action: ToastAction, button: HTMLButtonElement) => {
      if (!records.current.has(toast.id) || pendingActions.current.has(toast.id)) return;
      pendingActions.current.add(toast.id);
      if (document.activeElement === button) restoreFocus.current.set(toast.id, button);
      hold(toast.id);
      const failed = () => {
        if (!mounted.current || !records.current.has(toast.id)) return;
        pendingActions.current.delete(toast.id);
        setBusy((current) => {
          const next = new Set(current);
          next.delete(toast.id);
          return next;
        });
        release(toast);
      };
      try {
        const result = action.onAction();
        if (result) {
          setBusy((current) => new Set(current).add(toast.id));
          void result.then(() => {
            if (mounted.current) removeToast(toast.id, 'action');
          }, failed);
        } else {
          removeToast(toast.id, 'action');
        }
      } catch {
        failed();
      }
    },
    [hold, release, removeToast],
  );

  useEffect(() => {
    for (const [id, button] of restoreFocus.current) {
      if (busy.has(id)) continue;
      restoreFocus.current.delete(id);
      if (
        button.isConnected &&
        !button.disabled &&
        (document.activeElement === document.body || document.activeElement === button)
      )
        button.focus();
    }
  }, [busy]);

  const active = toasts.slice(0, 3);
  useEffect(() => {
    for (const toast of active) {
      if (!timers.current.has(toast.id)) start(toast.id, durationFor(toast));
    }
  }, [active, durationFor, start]);

  useEffect(() => {
    mounted.current = true;
    const activeTimers = timers.current;
    return () => {
      mounted.current = false;
      for (const timer of activeTimers.values()) {
        if (timer.handle) clearTimeout(timer.handle);
      }
      activeTimers.clear();
    };
  }, []);

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
              className={[
                styles.toast,
                styles[toast.variant ?? 'info'],
                toast.actions?.length && styles.multiple,
              ]
                .filter(Boolean)
                .join(' ')}
              role={toast.variant === 'danger' ? 'alert' : 'status'}
              aria-busy={busy.has(toast.id) || undefined}
              onMouseEnter={() => {
                hovered.current.add(toast.id);
                hold(toast.id);
              }}
              onFocus={() => {
                focused.current.add(toast.id);
                hold(toast.id);
              }}
              onMouseLeave={() => {
                hovered.current.delete(toast.id);
                release(toast);
              }}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  focused.current.delete(toast.id);
                  release(toast);
                }
              }}
            >
              <span className={styles.variantIcon} aria-hidden="true">
                <ToastIcon variant={toast.variant ?? 'info'} />
              </span>
              {toast.actions?.length ? (
                <div className={styles.content}>
                  <p className={styles.message}>{toast.message}</p>
                  <div className={styles.actions}>
                    {[...(toast.action ? [toast.action] : []), ...toast.actions].map(
                      (action, index) => (
                        <Button
                          key={`${String(index)}:${action.label}`}
                          size="sm"
                          variant="ghost"
                          className={styles.action}
                          disabled={busy.has(toast.id)}
                          onClick={(event) => choose(toast, action, event.currentTarget)}
                        >
                          {action.label}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <p className={styles.message}>{toast.message}</p>
                  {toast.action && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className={styles.action}
                      disabled={busy.has(toast.id)}
                      onClick={(event) => choose(toast, toast.action!, event.currentTarget)}
                    >
                      {toast.action.label}
                    </Button>
                  )}
                </>
              )}
              <IconButton
                icon={<CloseIcon />}
                size="sm"
                aria-label={dismissLabel}
                disabled={busy.has(toast.id)}
                onClick={() => {
                  if (!pendingActions.current.has(toast.id)) removeToast(toast.id, 'close');
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
