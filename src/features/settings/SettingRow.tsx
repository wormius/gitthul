import type { ReactNode } from 'react';

import styles from './SettingRow.module.css';

interface SettingRowProps {
  /** Rótulo visible a la izquierda del control. */
  label: string;
  children: ReactNode;
}

/** Fila reutilizable dentro de una sección de configuraciones: rótulo + control. */
export function SettingRow({ label, children }: SettingRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={styles.control}>{children}</div>
    </div>
  );
}
