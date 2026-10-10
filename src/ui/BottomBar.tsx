import type { ReactNode } from 'react';

import { Divider } from './Divider';
import styles from './BottomBar.module.css';

interface BottomBarProps {
  /** Nombre accesible de la barra. */
  label: string;
  /**
   * Botones que abren vistas. Van al inicio y **separados** de la tira por un
   * divisor: no son pestañas y no deben leerse como una.
   */
  launchers?: ReactNode;
  /** La tira de pestañas. */
  children?: ReactNode;
  /** Resultado de la última operación. */
  status?: ReactNode;
  /** Zona derecha: apoyo, versión, búsqueda, ayuda, modo, ajustes y registros. */
  utilities?: ReactNode;
}

/**
 * La barra inferior, compartida por todas las vistas.
 *
 * Reparte tres zonas y nada más: no sabe qué es una pestaña ni qué hace ninguno
 * de sus botones. Quien lo sabe es el shell, que es también el único que puede
 * decidir qué significa «abrir una terminal aquí».
 */
export function BottomBar({ label, launchers, children, status, utilities }: BottomBarProps) {
  return (
    <footer className={styles.bar} aria-label={label}>
      {launchers && (
        <>
          <div className={styles.launchers}>{launchers}</div>
          <Divider orientation="vertical" className={styles.divider} />
        </>
      )}

      {children}

      {status && <div className={styles.status}>{status}</div>}
      {utilities && <div className={styles.utilities}>{utilities}</div>}
    </footer>
  );
}
