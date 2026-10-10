import { useId, type InputHTMLAttributes } from 'react';

import styles from './Radio.module.css';

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

/** Mismo motivo de anillo que `Checkbox`, en forma circular. */
export function Radio({ label, id, className, ...rest }: RadioProps) {
  const generatedId = useId();
  const radioId = id ?? generatedId;

  return (
    <label className={[styles.wrapper, className].filter(Boolean).join(' ')} htmlFor={radioId}>
      <input type="radio" id={radioId} className={styles.input} {...rest} />
      <span className={styles.box} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </label>
  );
}
