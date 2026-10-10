import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './BigActionButton.module.css';

interface BigActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
}

/**
 * Icono grande arriba, etiqueta pequeña en mayúsculas debajo.
 *
 * Se repite en la fila de acciones de Repositorios (Abrir, Crear, Clonar…) y en
 * la barra de acciones de GitWorking. Sin caja propia hasta el hover o el foco:
 * lo que domina es el icono, no el botón.
 */
export function BigActionButton({
  icon,
  label,
  type = 'button',
  className,
  ...rest
}: BigActionButtonProps) {
  const classes = [styles.button, className].filter(Boolean).join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.label}>{label}</span>
    </button>
  );
}
