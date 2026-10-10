import { useId, type InputHTMLAttributes } from 'react';

import styles from './Switch.module.css';

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  label: string;
}

/** Interruptor de encendido/apagado inmediato, sin necesidad de confirmar. */
export function Switch({ label, id, className, ...rest }: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;

  return (
    <label className={[styles.wrapper, className].filter(Boolean).join(' ')} htmlFor={switchId}>
      <input type="checkbox" role="switch" id={switchId} className={styles.input} {...rest} />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  );
}
