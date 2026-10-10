import { GIT_ERRORS, isCancelled, isGitOperationError } from '@core/domain/errors';
import type { LogContext, LogLevel } from '@core/domain/logs';
import type { LogPort } from '@core/ports/LogPort';

let sequence = 0;
const operationSession = Math.random().toString(36).slice(2, 10);

/** Expected Git conditions require user action, but do not imply an app defect. */
const seriousGitErrors = new Set([
  'unknown',
  'checkout.restoreFailed',
  'resolve.writeFailed',
  'worktree.removeFailed',
  'text.encodingUnsupported',
  'path.encodingUnsupported',
  'ref.encodingUnsupported',
  'history.encodingUnsupported',
  'resolve.unrepresentable',
]);

export function errorLevel(error: unknown): LogLevel {
  if (isCancelled(error) || (error instanceof Error && error.name === 'AbortError')) return 'debug';
  if (isGitOperationError(error) && !seriousGitErrors.has(error.code)) return 'warn';
  return 'error';
}

function condition(code: string): string {
  if (code.endsWith('.conflict')) return 'Git encontró conflictos que requieren resolución';
  if (code.endsWith('.stale')) return 'el estado cambió; actualiza y vuelve a intentar';
  if (code.endsWith('.dirtyTree')) return 'Git protegió los cambios locales';
  const descriptions: Record<string, string> = {
    'auth.failed': 'Git no pudo autenticar el acceso al remoto',
    'network.unreachable': 'el remoto no está disponible por la red',
    'push.rejected': 'el remoto rechazó la publicación',
    'repo.locked': 'otra operación mantiene bloqueado el repositorio',
    'undo.snapshotUnavailable': 'no se pudo preparar la copia de recuperación',
    'checkout.restoreFailed': 'no se pudieron restaurar los cambios después del checkout',
    'resolve.writeFailed': 'no se pudo escribir la resolución en disco',
    unknown: 'fallo sin clasificar; consulta la salida original',
  };
  return descriptions[code] ?? code;
}

/** Bounded cause chain, including structured native errors rather than [object Object]. */
export function errorDetail(error: unknown, depth = 0): string {
  if (depth > 3) return '[cause depth limit]';
  try {
    if (error instanceof Error)
      return JSON.stringify(
        {
          name: error.name,
          message: error.message,
          ...(isGitOperationError(error)
            ? { code: error.code, params: error.params, output: error.output }
            : {}),
          stack: error.stack,
          ...(error.cause === undefined ? {} : { cause: errorDetail(error.cause, depth + 1) }),
        },
        null,
        2,
      );
    return typeof error === 'string' ? error : (JSON.stringify(error, null, 2) ?? String(error));
  } catch {
    return '[unserializable error]';
  }
}

/** Recording must never change the return value or the original rejection. */
export function logOperation<T>(
  log: LogPort,
  scope: string,
  method: string,
  label: string,
  context: LogContext,
  run: () => Promise<T>,
  successLevel: LogLevel | ((result: T) => LogLevel) = 'debug',
  summarize: (result: T) => string = () => 'completado',
  sanitize: (text: string) => string = (text) => text,
  trace = true,
): Promise<T> {
  const started = performance.now();
  const operationId = `${operationSession}:${++sequence}`;
  const base = { ...context, operationId, method };
  const write = (
    level: LogLevel,
    message: string,
    detail: string | undefined,
    extra: LogContext,
  ) => {
    try {
      log.write(level, scope, message, detail === undefined ? undefined : sanitize(detail), {
        ...base,
        ...extra,
      });
    } catch {
      /* A broken sink or subscriber must not break the user's operation. */
    }
  };
  if (trace) write('debug', `Inicio: ${label}`, undefined, { phase: 'start' });
  return Promise.resolve()
    .then(run)
    .then(
      (result) => {
        try {
          if (trace)
            write(
              typeof successLevel === 'function' ? successLevel(result) : successLevel,
              `Completado: ${label}`,
              undefined,
              {
                phase: 'success',
                durationMs: Math.round(performance.now() - started),
                result: summarize(result),
              },
            );
        } catch {
          /* Summary failures must not turn successful operations into failures. */
        }
        return result;
      },
      (error: unknown) => {
        const level = errorLevel(error);
        const cancelled = level === 'debug';
        const gitError = isGitOperationError(error) ? error : undefined;
        const code =
          gitError?.code ??
          (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : undefined);
        write(
          level,
          `${cancelled ? 'Cancelado' : level === 'warn' ? 'Requiere atención' : 'Falló'}: ${label}${code ? ` — ${condition(code)}` : ''}`,
          cancelled ? undefined : errorDetail(error),
          {
            phase: cancelled ? 'cancelled' : 'failure',
            durationMs: Math.round(performance.now() - started),
            ...(code ? { errorCode: code } : {}),
            ...(gitError ? { recovery: GIT_ERRORS[gitError.code].fixes.join(', ') } : {}),
          },
        );
        throw error;
      },
    );
}
