import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonContentAlign = 'center' | 'start';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Alineación del texto dentro del espacio disponible entre los iconos. */
  contentAlign?: ButtonContentAlign;
  /** Icono decorativo; el texto accesible siempre viene de `children`. */
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  /** Necesaria para anclar flotantes al botón. En React 19 viaja como una prop más. */
  ref?: Ref<HTMLButtonElement>;
}

/** Botón de texto. Primario para la acción principal de una vista, uno por vez. */
export function Button({
  variant = 'secondary',
  size = 'md',
  contentAlign = 'center',
  iconStart,
  iconEnd,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    styles[size],
    contentAlign === 'start' ? styles.start : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} {...rest}>
      {iconStart && (
        <span className={styles.icon} aria-hidden="true">
          {iconStart}
        </span>
      )}
      <span className={styles.label}>{children}</span>
      {iconEnd && (
        <span className={styles.icon} aria-hidden="true">
          {iconEnd}
        </span>
      )}
    </button>
  );
}
