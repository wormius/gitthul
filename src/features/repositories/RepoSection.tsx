import type { ReactNode } from 'react';

import { Counter } from '@ui/Counter';

import styles from './RepoSection.module.css';

interface RepoSectionProps {
  /** Para que un gesto pueda traer la sección a la vista sin una `ref`. */
  id?: string;
  title: string;
  /** Cuántos hay debajo. Sin valor no se pinta contador. */
  count?: number;
  /** Botones de la cabecera, alineados a la derecha del título. */
  actions?: ReactNode;
  /** `true` cuando la sección tiene que llenar el alto que le sobre. */
  fill?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Una sección del panel izquierdo: título tenue, contador y su contenido.
 *
 * Las tres —recientes, espacios y todos— se ven a la vez y se llega a ellas
 * bajando, no cambiando de pestaña. Lo que las separa es el aire y el título;
 * no hay ninguna línea horizontal, porque una raya entre dos zonas de la misma
 * columna promete un corte que no existe.
 */
export function RepoSection({
  id,
  title,
  count,
  actions,
  fill,
  className,
  children,
}: RepoSectionProps) {
  return (
    <section
      id={id}
      className={[styles.section, className].filter(Boolean).join(' ')}
      data-fill={fill ? '' : undefined}
      aria-label={title}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {count !== undefined && <Counter value={count} />}
        {actions && <span className={styles.actions}>{actions}</span>}
      </header>

      {children}
    </section>
  );
}
