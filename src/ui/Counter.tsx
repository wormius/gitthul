import type { HTMLAttributes } from 'react';

import styles from './Counter.module.css';

interface CounterProps extends HTMLAttributes<HTMLSpanElement> {
  value: number;
  /** Símbolo delante del número, p. ej. `+` para el `+N` de ramas que comparten commit. */
  prefix?: string;
}

/**
 * Contador numérico pequeño: cambios de una carpeta colapsada, o el `+N` de
 * ramas y tags que comparten commit.
 */
export function Counter({ value, prefix, className, ...rest }: CounterProps) {
  return (
    <span className={[styles.counter, className].filter(Boolean).join(' ')} {...rest}>
      {prefix}
      {value}
    </span>
  );
}
