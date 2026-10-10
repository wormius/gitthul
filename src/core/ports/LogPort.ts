import type { LogContext, LogEntry, LogFilter, LogLevel } from '@core/domain/logs';

/**
 * Dónde van a parar los registros.
 *
 * `write` no devuelve promesa: registrar no es una operación que se espere ni
 * que pueda fallar de cara a quien la llama — si el destino no acepta, lo peor
 * que puede pasar es que se pierda una línea, nunca que se rompa la operación
 * que la estaba contando.
 *
 * Normal keeps milestones and incidents; debug additionally records routine diagnostics.
 */
export interface LogPort {
  write: (
    level: LogLevel,
    scope: string,
    message: string,
    detail?: string,
    context?: LogContext,
  ) => void;
  /** Affects collection, not just the viewer. Defaults to false. */
  setDebugEnabled: (enabled: boolean) => void;
  read: (filter?: LogFilter) => Promise<readonly LogEntry[]>;
  /** Avisa de cada entrada nueva. Devuelve cómo dejar de escuchar. */
  subscribe: (listener: (entry: LogEntry) => void) => () => void;
  /** Exporta todos los registros retenidos, o solo avisos y errores. False indica cancelación. */
  export: (errorsOnly?: boolean) => Promise<boolean>;
  clear: () => Promise<void>;
  /** Abre la carpeta nativa que contiene el archivo actual. */
  openDirectory: () => Promise<void>;
}
