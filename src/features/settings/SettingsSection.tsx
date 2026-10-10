import { type ReactNode, useId } from 'react';

import styles from './SettingsSection.module.css';

interface SettingsSectionProps {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  /**
   * Medida ancha, para secciones con vistas previas.
   *
   * Las seis secciones de formulario se leen mejor estrechas —`54rem`, la medida
   * que salió de probar F4.1 en una ventana panorámica—, pero Apariencia enseña
   * maquetas y ocho chips de tema, y con esa medida los chips salían de dos en
   * dos.
   */
  wide?: boolean;
}

/** Contenedor legible de una sección, con sus controles agrupados y acciones al pie. */
export function SettingsSection({ title, children, actions, wide = false }: SettingsSectionProps) {
  const headingId = useId();

  return (
    <section
      className={[styles.section, wide && styles.wide].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
    >
      <h1 id={headingId} className={styles.heading}>
        {title}
      </h1>
      <div className={styles.panel}>
        <div className={styles.body}>{children}</div>
        {actions && (
          <div className={styles.actions}>
            <div className={styles.actionContent}>{actions}</div>
          </div>
        )}
      </div>
    </section>
  );
}
