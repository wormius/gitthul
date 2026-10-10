import type { HTMLAttributes } from 'react';

import styles from './Skeleton.module.css';

export type SkeletonVariant = 'text' | 'block' | 'circle';

interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: SkeletonVariant;
}

/** Marcador de espera con la forma de lo que va a aparecer. Decorativo: fuera del árbol de accesibilidad. */
export function Skeleton({ variant = 'block', className, ...rest }: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, styles[variant], className].filter(Boolean).join(' ')}
      aria-hidden="true"
      {...rest}
    />
  );
}
