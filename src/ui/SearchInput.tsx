import { useId, type ChangeEvent, type InputHTMLAttributes, type Ref } from 'react';

import styles from './SearchInput.module.css';
import hiddenStyles from './visuallyHidden.module.css';

interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> {
  /** Texto accesible; el icono y el placeholder ya comunican que es una búsqueda, así que se oculta visualmente. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Etiqueta accesible del botón de vaciar, p. ej. «Vaciar búsqueda de ramas». */
  clearLabel: string;
  /** Ya formateado por quien lo llama, p. ej. «3 resultados» — pasa por i18n allá arriba. */
  resultsLabel?: string;
  /** Para llevarle el foco desde fuera. En React 19 viaja como una prop más. */
  ref?: Ref<HTMLInputElement>;
}

/** `Input` de texto especializado en filtrar: botón de limpiar y conteo de resultados. */
export function SearchInput({
  label,
  value,
  onChange,
  clearLabel,
  resultsLabel,
  ref,
  id,
  className,
  ...rest
}: SearchInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <label className={hiddenStyles.hidden} htmlFor={inputId}>
        {label}
      </label>
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M11 11 14.5 14.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <input
        ref={ref}
        id={inputId}
        type="search"
        className={styles.input}
        value={value}
        onChange={handleChange}
        {...rest}
      />
      <span className={styles.controls}>
        {value && (
          <button
            type="button"
            className={styles.clear}
            aria-label={clearLabel}
            onClick={() => onChange('')}
          >
            <svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        {resultsLabel && <span className={styles.count}>{resultsLabel}</span>}
      </span>
    </div>
  );
}
