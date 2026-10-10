/**
 * Los tipos del dominio de la terminal.
 *
 * Mínimos a propósito: la terminal es un flujo de líneas, y el dominio no
 * sabe si vienen de un PTY real o del adaptador falso. xterm.js (F6.7)
 * reemplazará el componente de salida, pero estos tipos siguen valiendo
 * porque el puerto los usa igual.
 */

export interface TerminalOutputLine {
  /** `stdout` o `stderr`; en la fase falsa todo es `stdout`. */
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface TerminalPaneDescriptor {
  kind: 'pane';
  id: string;
  /** Nombre elegido por la persona; `null` usa el nombre localizado por posición. */
  title: string | null;
  /** Cwd inicial del proceso nuevo. Nunca representa un proceso persistido. */
  cwd: string;
}

export interface TerminalSplitDescriptor {
  kind: 'split';
  id: string;
  orientation: 'horizontal' | 'vertical';
  ratio: number;
  first: TerminalLayoutNode;
  second: TerminalLayoutNode;
}

export type TerminalLayoutNode = TerminalPaneDescriptor | TerminalSplitDescriptor;

/** Solo geometría recuperable; no contiene PTY, scrollback ni ids de proceso. */
export interface TerminalLayout {
  root: TerminalLayoutNode;
  activePaneId: string;
}
