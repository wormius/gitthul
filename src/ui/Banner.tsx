import type { ReactNode } from 'react';

import { IconButton } from './IconButton';
import styles from './Banner.module.css';

export type BannerVariant = 'info' | 'success' | 'warning' | 'danger';

interface BannerProps {
  variant?: BannerVariant;
  /** Frase completa, con las ramas nombradas. */
  title: string;
  /** Acciones del aviso, ya ordenadas. */
  actions?: ReactNode;
  onDismiss?: () => void;
  /** Obligatoria si el aviso se puede descartar. */
  dismissLabel?: string;
  children?: ReactNode;
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

/**
 * Aviso persistente dentro de una vista.
 *
 * A diferencia del toast no se va solo: es para lo que sigue siendo cierto
 * mientras esté ahí — un rebase a medias, un repositorio en conflicto, un
 * worktree desincronizado.
 */
export function Banner({
  variant = 'info',
  title,
  actions,
  onDismiss,
  dismissLabel,
  children,
}: BannerProps) {
  return (
    <div
      className={[styles.banner, styles[variant]].join(' ')}
      role={variant === 'danger' ? 'alert' : 'status'}
    >
      <div className={styles.content}>
        <p className={styles.title}>{title}</p>
        {children && <div className={styles.detail}>{children}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
      {onDismiss && dismissLabel && (
        <IconButton icon={<CloseIcon />} size="sm" aria-label={dismissLabel} onClick={onDismiss} />
      )}
    </div>
  );
}
