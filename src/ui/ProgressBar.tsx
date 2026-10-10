import styles from './ProgressBar.module.css';

interface ProgressBarProps {
  /** Ausente: indeterminada. Presente: 0 a 100. */
  value?: number;
  label: string;
  className?: string;
}

/** Determinada e indeterminada, para clone y fetch. */
export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const indeterminate = value === undefined;
  const clamped = indeterminate ? undefined : Math.min(100, Math.max(0, value));

  return (
    <div
      className={[styles.track, className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <div
        className={[styles.fill, indeterminate && styles.indeterminate].filter(Boolean).join(' ')}
        style={indeterminate ? undefined : { width: `${String(clamped)}%` }}
      />
    </div>
  );
}
