import styles from './Spinner.module.css';

export type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps {
  size?: SpinnerSize;
  /** Texto accesible, p. ej. «Cargando» o «Clonando repositorio». */
  label: string;
  className?: string;
}

/** Indicador de progreso indeterminado. Toda operación asíncrona lleva uno. */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={[styles.wrapper, className].filter(Boolean).join(' ')}
    >
      <span className={[styles.spinner, styles[size]].join(' ')} aria-hidden="true" />
    </span>
  );
}
