import type { HTMLAttributes, ReactNode } from 'react';

import styles from './Chip.module.css';

interface ChipProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  icon?: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
  /** Si se da, aparece el botón de quitar; su etiqueta accesible es obligatoria. */
  onRemove?: () => void;
  removeLabel?: string;
}

/**
 * Etiqueta de filtro o de rama/tag, alternable y opcionalmente removible.
 *
 * **Sin `onSelect` el cuerpo no es un botón, es un `span`.** Una píldora que solo
 * dice algo —a qué espacios pertenece un repositorio, por ejemplo— no tiene por
 * qué parar el tabulador ni anunciarse como control, y dentro de una fila que ya
 * es `option` un botón anidado además rompería el papel de la fila. Lo que decide
 * es si hay algo que pulsar, no cómo se ve: las dos formas se pintan igual.
 */
export function Chip({
  icon,
  selected,
  onSelect,
  onRemove,
  removeLabel,
  className,
  children,
  ...rest
}: ChipProps) {
  const classes = [styles.chip, selected && styles.selected, className].filter(Boolean).join(' ');
  const bodyClass = [styles.body, !onRemove && styles.noRemove].filter(Boolean).join(' ');
  const body = (
    <>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.label}>{children}</span>
    </>
  );

  return (
    <span className={classes}>
      {onSelect ? (
        <button
          type="button"
          className={bodyClass}
          aria-pressed={selected}
          onClick={onSelect}
          {...rest}
        >
          {body}
        </button>
      ) : (
        <span className={bodyClass} {...rest}>
          {body}
        </span>
      )}
      {onRemove && (
        <button type="button" className={styles.remove} aria-label={removeLabel} onClick={onRemove}>
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
    </span>
  );
}
