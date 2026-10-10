import { useEffect, useRef } from 'react';

import type { TerminalOutputLine } from '@core/domain/terminal';

import styles from './TerminalOutput.module.css';

export interface OutputEntry {
  /** Comando que se escribió. */
  command: string;
  /** Carpeta en la que se ejecutó. */
  cwd: string;
  /** Líneas de salida. */
  lines: readonly TerminalOutputLine[];
}

interface TerminalOutputProps {
  entries: readonly OutputEntry[];
  /** Nombre accesible de la zona de salida. */
  label: string;
}

/**
 * La zona de scroll-back de la terminal: todos los comandos ejecutados con su
 * salida, seleccionables para copiar. Se desplaza al fondo en cada entrada nueva.
 */
export function TerminalOutput({ entries, label }: TerminalOutputProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [entries.length]);

  return (
    <div className={styles.output} role="log" aria-label={label} aria-live="polite">
      {entries.map((entry, entryIndex) => (
        <div key={entryIndex}>
          <span className={styles.line}>
            <span className={styles.prompt}>{entry.cwd}$ </span>
            <span className={styles.command}>{entry.command}</span>
          </span>
          {entry.lines.map((line, lineIndex) => (
            <span
              key={lineIndex}
              className={`${styles.line} ${line.stream === 'stderr' ? styles.stderr : ''}`}
            >
              {line.text}
            </span>
          ))}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
