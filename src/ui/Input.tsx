import { useId, type InputHTMLAttributes } from 'react';

import styles from './Input.module.css';
import hiddenStyles from './visuallyHidden.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Oculta la etiqueta visualmente; sigue disponible para lector de pantalla. */
  hideLabel?: boolean;
  error?: string;
  hint?: string;
}

/** Campo de texto de una línea, con etiqueta, ayuda y error propios. */
export function Input({ label, hideLabel, error, hint, id, className, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className={styles.field}>
      <label
        className={[styles.label, hideLabel && hiddenStyles.hidden].filter(Boolean).join(' ')}
        htmlFor={inputId}
      >
        {label}
      </label>
      <input
        id={inputId}
        className={[styles.input, error && styles.invalid, className].filter(Boolean).join(' ')}
        aria-invalid={Boolean(error)}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {hint && !error && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
