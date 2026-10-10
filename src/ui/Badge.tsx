import type { HTMLAttributes } from 'react';

import styles from './Badge.module.css';

export type BadgeVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/** Etiqueta corta de estado, no interactiva: «Sin conflictos», «Push rechazado»… */
export function Badge({ variant = 'neutral', className, children, ...rest }: BadgeProps) {
  const classes = [styles.badge, styles[variant], className].filter(Boolean).join(' ');

  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
