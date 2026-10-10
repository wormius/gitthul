import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';

interface EmptyStateProps {
  /** Qué falta, dicho en positivo: «Todavía no hay repositorios». */
  title: string;
  /** Cómo salir de aquí. Un estado vacío sin salida es un callejón. */
  description?: string;
  icon?: ReactNode;
  /** Botones que resuelven el vacío. */
  actions?: ReactNode;
  size?: 'sm' | 'md';
}

/** Lo que se pinta donde no hay nada que pintar. */
export function EmptyState({ title, description, icon, actions, size = 'md' }: EmptyStateProps) {
  return (
    <div className={[styles.empty, styles[size]].join(' ')}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <p className={styles.title}>{title}</p>
      {description && <p className={styles.description}>{description}</p>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
