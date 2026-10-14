import { GIT_ERRORS, isCancelled, isGitOperationError } from '@core/domain/errors';
import type { LogContext, LogErrorDiagnostic, LogLevel, LogMetadata } from '@core/domain/logs';
import type { LogPort } from '@core/ports/LogPort';
import { boundLogText, redactLogValue } from '@core/domain/logPrivacy';

let sequence = 0;
const operationSession = Math.random().toString(36).slice(2, 10);
const history = new WeakMap<LogPort, LogMetadata[]>();

export function clearOperationHistory(log: LogPort): void {
  history.delete(log);
}

function remember(log: LogPort, context: LogContext, scope: string): void {
  const entries = history.get(log) ?? [];
  entries.push({
    operationId: context.operationId ?? '',
    method: context.method ?? '',
    scope,
    phase: context.phase ?? 'event',
    startedAt: context.startedAt ?? Date.now(),
    ...(context.repository === undefined ? {} : { repository: context.repository }),
    ...(context.durationMs === undefined ? {} : { durationMs: context.durationMs }),
    ...(context.errorCode === undefined ? {} : { errorCode: context.errorCode }),
  });
  history.set(log, entries.slice(-48));
}

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
  try {
    if (isCancelled(error) || (error instanceof Error && error.name === 'AbortError'))
      return 'debug';
    if (isGitOperationError(error) && !seriousGitErrors.has(error.code)) return 'warn';
  } catch {
    // A malformed error must remain the operation's original rejection.
  }
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
    'branch.checkoutBlocked':
      'Git protegió archivos locales; crea un stash o haz commit antes de reintentar',
    'resolve.writeFailed': 'no se pudo escribir la resolución en disco',
    unknown: 'fallo sin clasificar; consulta la salida original',
  };
  return descriptions[code] ?? code;
}

/** Keep the useful part of every cause, even if a later cause cycles or has a broken getter. */
export function errorDiagnostic(
  error: unknown,
  sanitize: (text: string) => string = (text) => text,
): LogErrorDiagnostic {
  const seen = new WeakSet<object>();
  const capture = (value: unknown, depth: number): LogErrorDiagnostic => {
    if (depth > 5) return { message: '[truncated: cause depth limit]' };
    if (!value || typeof value !== 'object') return { message: String(value) };
    if (seen.has(value)) return { message: '[circular reference]' };
    seen.add(value);
    const record = value as Record<string, unknown>;
    const fields: Record<string, unknown> = {};
    for (const key of ['name', 'message', 'stack', 'code', 'params', 'output', 'diagnostic']) {
      try {
        if (record[key] !== undefined) fields[key] = record[key];
      } catch {
        fields[key] = '[unreadable property]';
      }
    }
    try {
      if (record['cause'] !== undefined) fields['cause'] = capture(record['cause'], depth + 1);
    } catch {
      fields['cause'] = { message: '[unreadable cause]' };
    }
    if (Object.keys(fields).length === 0)
      fields['message'] = JSON.stringify(redactLogValue(value, sanitize));
    return fields;
  };
  try {
    return redactLogValue(capture(error, 0), sanitize) as unknown as LogErrorDiagnostic;
  } catch {
    return { message: '[unreadable error diagnostic]' };
  }
}

/** Detail remains human readable and compatible with reports produced before schema 3. */
export function errorDetail(error: unknown): string {
  return boundLogText(JSON.stringify(errorDiagnostic(error), null, 2), 15000);
}

export interface OperationSummary {
  text: string;
  data?: LogMetadata;
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
  summarize: (result: T) => string | OperationSummary = () => 'completado',
  sanitize: (text: string) => string = (text) => text,
  trace = true,
  startLevel?: LogLevel,
): Promise<T> {
  const started = performance.now();
  const startedAt = Date.now();
  const operationId = `${operationSession}:${++sequence}`;
  const base = { ...context, operationId, method, startedAt };
  const write = (
    level: LogLevel,
    message: string,
    detail: string | undefined,
    extra: LogContext,
  ) => {
    try {
      const full = {
        ...base,
        ...extra,
      };
      log.write(
        level,
        scope,
        message,
        detail === undefined ? undefined : boundLogText(sanitize(detail), 15000),
        redactLogValue(full, sanitize) as unknown as LogContext,
      );
    } catch {
      /* A broken sink or subscriber must not break the user's operation. */
    }
  };
  if (trace && startLevel !== undefined) {
    write(startLevel, `Inicio: ${label}`, undefined, { phase: 'start' });
    if (startLevel !== 'debug') remember(log, { ...base, phase: 'start' }, scope);
  }
  return Promise.resolve()
    .then(run)
    .then(
      (result) => {
        try {
          if (trace) {
            const summary = summarize(result);
            const terminal = {
              phase: 'success' as const,
              durationMs: Math.round(performance.now() - started),
              result: typeof summary === 'string' ? summary : summary.text,
              ...(typeof summary === 'string' || summary.data === undefined
                ? {}
                : { resultData: summary.data }),
            };
            write(
              typeof successLevel === 'function' ? successLevel(result) : successLevel,
              `Completado: ${label}`,
              undefined,
              terminal,
            );
            remember(log, { ...base, ...terminal }, scope);
          }
        } catch {
          /* Summary failures must not turn successful operations into failures. */
        }
        return result;
      },
      (error: unknown) => {
        const level = errorLevel(error);
        const cancelled = level === 'debug';
        const gitError = isGitOperationError(error) ? error : undefined;
        const diagnostic = errorDiagnostic(error, sanitize);
        const code = typeof diagnostic.code === 'string' ? diagnostic.code : undefined;
        const native = diagnostic.diagnostic;
        const nativeOperationId =
          native &&
          typeof native === 'object' &&
          !Array.isArray(native) &&
          typeof native['diagnosticId'] === 'string'
            ? native['diagnosticId']
            : undefined;
        const recentOperations = (history.get(log) ?? [])
          .filter(
            (entry) => entry['repository'] === undefined || entry['repository'] === base.repository,
          )
          .slice(-12);
        const terminal = {
          phase: cancelled ? ('cancelled' as const) : ('failure' as const),
          durationMs: Math.round(performance.now() - started),
          ...(code ? { errorCode: code } : {}),
          ...(gitError && code && code in GIT_ERRORS
            ? { recovery: GIT_ERRORS[code as keyof typeof GIT_ERRORS].fixes.join(', ') }
            : {}),
          ...(cancelled ? {} : { error: diagnostic, recentOperations }),
          ...(nativeOperationId === undefined ? {} : { nativeOperationId }),
        };
        write(
          level,
          `${cancelled ? 'Cancelado' : level === 'warn' ? 'Requiere atención' : 'Falló'}: ${label}${code ? ` — ${condition(code)}` : ''}`,
          cancelled ? undefined : JSON.stringify(diagnostic, null, 2),
          terminal,
        );
        remember(log, { ...base, ...terminal }, scope);
        throw error;
      },
    );
}
