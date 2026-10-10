import type { ReactNode } from 'react';

import { Button } from './Button';
import styles from './ErrorPanel.module.css';

export interface ErrorFix {
  key: string;
  /** Nombra la operación y sus ramas: «Traer `origin/main` y reintentar». */
  label: string;
  onSelect: () => void;
  /** El arreglo más probable. Solo uno. */
  primary?: boolean;
}

interface ErrorPanelProps {
  /** Qué pasó, en una frase y sin jerga. */
  title: string;
  /** Por qué pasó. */
  cause?: string;
  /** Uno o dos arreglos. Más de dos ya es una lista de opciones, no una salida. */
  fixes?: readonly ErrorFix[];
  /** La salida cruda de git, plegada. Nunca es la respuesta, solo la evidencia. */
  output?: string;
  /** Rótulo del pliegue, p. ej. «Salida de git». Obligatorio si hay salida. */
  outputLabel?: string;
  /** Detalle propio del caso: la lista de commits ajenos de un push rechazado. */
  children?: ReactNode;
}

/**
 * Cómo GitThul cuenta un fallo: frase clara, causa, botones de arreglo y, al
 * final y plegada, la salida original de git.
 *
 * La salida cruda no se esconde — hace falta para reportar — pero tampoco es la
 * respuesta: quien abre GitThul para no leer la línea de comandos no debería
 * tener que leerla justo cuando algo se rompió.
 */
export function ErrorPanel({
  title,
  cause,
  fixes,
  output,
  outputLabel,
  children,
}: ErrorPanelProps) {
  return (
    <section className={styles.panel} role="alert">
      <h3 className={styles.title}>{title}</h3>
      {cause && <p className={styles.cause}>{cause}</p>}
      {children && <div className={styles.detail}>{children}</div>}

      {fixes && fixes.length > 0 && (
        <div className={styles.fixes}>
          {fixes.map((fix) => (
            <Button
              key={fix.key}
              variant={fix.primary ? 'primary' : 'secondary'}
              onClick={fix.onSelect}
            >
              {fix.label}
            </Button>
          ))}
        </div>
      )}

      {output && outputLabel && (
        <details className={styles.output}>
          <summary className={styles.summary}>{outputLabel}</summary>
          <pre className={styles.raw} data-selectable>
            {output}
          </pre>
        </details>
      )}
    </section>
  );
}
