import type { ReactNode } from 'react';

import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /**
   * Solo los iconos, con el rótulo como nombre accesible.
   *
   * Para barras donde no cabe el texto. Cada opción **tiene que** traer icono:
   * sin él el segmento se queda sin nada que enseñar, y por eso el rótulo sigue
   * siendo obligatorio aunque no se pinte.
   */
  hideLabels?: boolean;
  className?: string;
}

/** Grupo excluyente de opciones visibles a la vez: lista/árbol, hunks/archivo… */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  hideLabels = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={[styles.group, className].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={[styles.segment, selected && styles.selected, hideLabels && styles.iconOnly]
              .filter(Boolean)
              .join(' ')}
            {...(hideLabels ? { 'aria-label': option.label, title: option.label } : {})}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {option.icon && (
              <span className={styles.icon} aria-hidden="true">
                {option.icon}
              </span>
            )}
            {!hideLabels && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
