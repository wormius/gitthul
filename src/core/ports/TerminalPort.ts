import type { TerminalOutputLine } from '@core/domain/terminal';

/**
 * Lo que la terminal necesita para ejecutar comandos.
 *
 * El navegador responde con eco y salidas fijas para pruebas y galería. La app
 * nativa selecciona `TerminalPtyPort`, que transporta bytes sin interpretarlos.
 */
export interface TerminalCommandPort {
  kind: 'commands';
  /**
   * Ejecuta un comando y emite la salida línea a línea.
   *
   * El iterador se cancela con `signal.abort()`: el adaptador falso deja de
   * emitir y rechaza con `OperationCancelledError`.
   */
  execute(
    sessionId: string,
    command: string,
    signal?: AbortSignal,
  ): AsyncIterable<TerminalOutputLine>;

  /** Historial de comandos de la sesión, más reciente al final. */
  getHistory(sessionId: string): Promise<readonly string[]>;
}

export interface TerminalSessionRequest {
  sessionId: string;
  cwd: string;
  cols: number;
  rows: number;
  onData: (data: Uint8Array) => void;
  /** Cwd real observado por el backend; puede no estar disponible en la plataforma. */
  onCwd?: (cwd: string) => void;
  onExit?: (exit: TerminalExit) => void;
}

export interface TerminalExit {
  code: number;
  signal: string | null;
  success: boolean;
}

/** Frontera de bytes de una sesión PTY; no interpreta prompts ni comandos. */
export interface TerminalPtyPort {
  kind: 'pty';
  createSession(request: TerminalSessionRequest): Promise<void>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
}

export type TerminalPort = TerminalCommandPort | TerminalPtyPort;
