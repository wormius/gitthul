import { logEntryFactory } from '../logEntry';
import { clearOperationHistory, errorDiagnostic } from '../logOperation';
import { redactLogText, redactLogValue } from '@core/domain/logPrivacy';
import {
  atLeast,
  type LogEntry,
  type LogFilter,
  type LogLevel,
  type LogMetadata,
} from '@core/domain/logs';
import type { LogPort } from '@core/ports/LogPort';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

async function tauriInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
}

function filtered(entries: readonly LogEntry[], filter: LogFilter): readonly LogEntry[] {
  let found = entries;
  if (filter.minLevel) found = found.filter((entry) => atLeast(entry.level, filter.minLevel!));
  if (filter.scope !== undefined) found = found.filter((entry) => entry.scope === filter.scope);
  return filter.limit === undefined ? found : found.slice(-filter.limit);
}

function environmentText(text: string, limit: number): string {
  const safe = redactLogText(text);
  const encoder = new TextEncoder();
  if (encoder.encode(safe).length <= limit) return safe;
  const marker = '[truncated]';
  let prefix = '';
  let bytes = marker.length;
  for (const character of safe) {
    bytes += encoder.encode(character).length;
    if (bytes > limit) break;
    prefix += character;
  }
  return prefix + marker;
}

/** La misma corriente de `LogPort`, respaldada por el archivo nativo de la aplicación. */
export function createTauriLogPort(call: Invoke = tauriInvoke): LogPort {
  const listeners = new Set<(entry: LogEntry) => void>();
  const makeEntry = logEntryFactory();
  let debugEnabled = false;
  let storageFailure: LogEntry | undefined;
  const notify = (entry: LogEntry) => {
    for (const listener of listeners) {
      try {
        listener(entry);
      } catch {
        /* Isolate subscribers. */
      }
    }
  };
  const environment: Partial<LogEntry> = {};
  let system: LogMetadata | undefined;
  let pending = call('log_environment')
    .then((value) => {
      if (value && typeof value === 'object') {
        const fields = value as Record<string, unknown>;
        for (const key of ['sessionId', 'platform', 'appVersion', 'gitVersion'] as const) {
          if (typeof fields[key] === 'string')
            environment[key] = environmentText(fields[key], key === 'platform' ? 1024 : 128);
        }
        if (fields['environment'] && typeof fields['environment'] === 'object')
          system = redactLogValue(fields['environment']) as LogMetadata;
      }
    })
    .catch(() => undefined);
  const log: LogPort = {
    setDebugEnabled: (enabled) => {
      debugEnabled = enabled;
    },
    write: (level: LogLevel, scope, message, detail, context) => {
      if (level === 'debug' && !debugEnabled) return;
      const entry = makeEntry(level, scope, message, debugEnabled, detail, context);
      let persisted = false;
      pending = pending
        .then(async () => {
          // Do not mutate an entry already delivered to subscribers: identity must remain stable.
          const stored = {
            ...entry,
            ...environment,
            context: redactLogValue({
              ...entry.context,
              environment: system,
            }) as LogEntry['context'],
          };
          notify(stored);
          await call('log_append', { entry: stored });
          persisted = true;
          if (storageFailure) {
            await call('log_append', { entry: storageFailure });
            storageFailure = undefined;
          }
        })
        .then(() => undefined)
        .catch((error: unknown) => {
          if (!storageFailure) {
            storageFailure = {
              ...makeEntry(
                'error',
                'logging',
                'No se pudieron guardar los registros; el diagnóstico en disco está incompleto',
                debugEnabled,
                String(error),
                {
                  error: errorDiagnostic(error),
                  report: { lostEntries: persisted ? 0 : 1 },
                  environment: system,
                },
              ),
              ...environment,
            };
            notify(storageFailure);
          } else {
            const lost =
              Number(storageFailure.context?.report?.['lostEntries'] ?? 1) + (persisted ? 0 : 1);
            storageFailure = {
              ...storageFailure,
              context: { ...storageFailure.context, report: { lostEntries: lost } },
            };
            notify(storageFailure);
          }
        });
    },
    read: async (filter = {}) => {
      await pending;
      let entries: readonly LogEntry[];
      try {
        entries = (await call('log_read')) as readonly LogEntry[];
      } catch (error) {
        if (!storageFailure) throw error;
        entries = [];
      }
      return filtered(storageFailure ? [...entries, storageFailure] : entries, filter);
    },
    export: async (errorsOnly = false) => {
      await pending;
      // Preserve evidence of dropped entries in the report when storage is available again.
      if (storageFailure) {
        await call('log_append', { entry: storageFailure });
        storageFailure = undefined;
      }
      return (await call('log_export', { errorsOnly })) as boolean;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear: async () => {
      await pending;
      await call('log_clear');
      storageFailure = undefined;
      clearOperationHistory(log);
    },
    openDirectory: async () => {
      await call('log_open_directory');
    },
  };
  return log;
}
