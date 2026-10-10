import { useId, type SelectHTMLAttributes } from 'react';

import styles from './Select.module.css';
import hiddenStyles from './visuallyHidden.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption[];
}

/** Envoltorio con estilo del `<select>` nativo: teclado y lector de pantalla gratis. */
export function Select({ label, hideLabel, options, id, className, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className={styles.field}>
      <label
        className={[styles.label, hideLabel && hiddenStyles.hidden].filter(Boolean).join(' ')}
        htmlFor={selectId}
      >
        {label}
      </label>
      <select
        id={selectId}
        className={[styles.select, className].filter(Boolean).join(' ')}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
