/**
 * Los registros de la aplicación.
 *
 * Son la única superficie de GitThul que no pasa por i18n, y es a propósito: un
 * registro no es texto de interfaz, es evidencia técnica que se copia dentro de
 * un reporte de fallo. Traducirlo lo volvería inútil para quien lo lee — el
 * mismo argumento por el que `ErrorPanel` enseña la salida de git tal cual.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogValue = string | number | boolean | null | LogValue[] | { [key: string]: LogValue };
export type LogMetadata = Record<string, LogValue>;

export interface LogErrorDiagnostic {
  name?: string;
  message?: string;
  stack?: string;
  code?: string;
  params?: LogValue;
  output?: string;
  cause?: LogErrorDiagnostic;
  diagnostic?: LogValue;
}

/** Stable fields for support tools; detail remains readable diagnostic evidence. */
export interface LogContext {
  operationId?: string;
  nativeOperationId?: string;
  method?: string;
  phase?: 'start' | 'success' | 'failure' | 'cancelled' | 'event';
  durationMs?: number;
  startedAt?: number;
  repository?: string;
  request?: string;
  requestData?: LogMetadata;
  result?: string;
  resultData?: LogMetadata;
  error?: LogErrorDiagnostic;
  recentOperations?: LogMetadata[];
  errorCode?: string;
  recovery?: string;
  report?: LogMetadata;
  environment?: LogMetadata;
}

export interface LogEntry {
  /** Creciente dentro de la sesión: ordena y sirve de clave de lista. */
  id: number;
  /** Milisegundos, UTC. */
  at: number;
  level: LogLevel;
  /** De dónde vino: `git.read`, `settings`, `shell`. Sirve para filtrar. */
  scope: string;
  message: string;
  /** Lo largo: el comando completo, la salida, la traza. */
  detail?: string;
  schemaVersion?: number;
  sessionId?: string;
  appVersion?: string;
  platform?: string;
  gitVersion?: string;
  origin?: 'frontend' | 'backend';
  debugEnabled?: boolean;
  context?: LogContext;
}

export interface LogFilter {
  /** Nivel mínimo. `warn` deja fuera `debug` e `info`. */
  minLevel?: LogLevel;
  scope?: string;
  /** Los últimos N, que es lo que el visor pinta primero. */
  limit?: number;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function atLeast(level: LogLevel, minimum: LogLevel): boolean {
  return ORDER[level] >= ORDER[minimum];
}
