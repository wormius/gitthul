import styles from './Divider.module.css';

interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/** Separador visual, sin significado propio para el lector de pantalla. */
export function Divider({ orientation = 'horizontal', className }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={[styles.divider, styles[orientation], className].filter(Boolean).join(' ')}
    />
  );
}
