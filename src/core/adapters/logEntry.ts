import { boundLogText, redactLogText, redactLogValue } from '@core/domain/logPrivacy';
import type { LogContext, LogEntry, LogLevel } from '@core/domain/logs';

/** One session per journal, shared by every instrumented subsystem. */
export function logEntryFactory() {
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let sequence = Date.now() * 1000;
  return (
    level: LogLevel,
    scope: string,
    message: string,
    debugEnabled: boolean,
    detail?: string,
    context?: LogContext,
  ): LogEntry => ({
    id: ++sequence,
    at: Date.now(),
    schemaVersion: 3,
    sessionId,
    appVersion: __APP_VERSION__,
    platform: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    origin: 'frontend',
    debugEnabled,
    level,
    scope: redactLogText(scope).slice(0, 128),
    message: boundLogText(redactLogText(message), 4000),
    ...(detail === undefined ? {} : { detail: boundLogText(redactLogText(detail), 15000) }),
    ...(context === undefined
      ? {}
      : {
          context: redactLogValue(context) as unknown as LogContext,
        }),
  });
}
