import type { HTMLAttributes } from 'react';

import styles from './Kbd.module.css';

type KbdProps = HTMLAttributes<HTMLElement>;

/**
 * Una sola tecla de un atajo, p. ej. `Ctrl`. Los combos los arma quien la usa
 * repitiendo `Kbd` y uniéndolas con el separador de su elección.
 */
export function Kbd({ className, children, ...rest }: KbdProps) {
  return (
    <kbd className={[styles.key, className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </kbd>
  );
}
