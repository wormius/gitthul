import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import styles from './IconButton.module.css';

export type IconButtonVariant = 'primary' | 'secondary' | 'ghost';
export type IconButtonSize = 'sm' | 'md' | 'lg';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: ReactNode;
  /** Obligatoria: sin texto visible, es la única descripción para lector de pantalla. */
  'aria-label': string;
  /** Necesaria para anclar flotantes al botón. En React 19 viaja como una prop más. */
  ref?: Ref<HTMLButtonElement>;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Estado presionado, para alternar/mostrar-ocultar. */
  pressed?: boolean;
}

/** Botón cuadrado de solo icono. La etiqueta accesible es obligatoria, nunca opcional. */
export function IconButton({
  icon,
  variant = 'ghost',
  size = 'md',
  pressed,
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  const classes = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} aria-pressed={pressed} {...rest}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}
