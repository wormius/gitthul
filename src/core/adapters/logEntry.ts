import { redactLogText } from '@core/domain/logPrivacy';
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
    schemaVersion: 2,
    sessionId,
    appVersion: __APP_VERSION__,
    platform: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    origin: 'frontend',
    debugEnabled,
    level,
    scope: redactLogText(scope).slice(0, 128),
    message: redactLogText(message).slice(0, 4000),
    ...(detail === undefined ? {} : { detail: redactLogText(detail).slice(0, 15000) }),
    ...(context === undefined
      ? {}
      : {
          context: Object.fromEntries(
            Object.entries(context).map(([key, value]) => [
              key,
              typeof value === 'string' ? redactLogText(value).slice(0, 10000) : value,
            ]),
          ),
        }),
  });
}
