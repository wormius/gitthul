import { logEntryFactory } from '../logEntry';
import { atLeast, type LogEntry, type LogFilter, type LogLevel } from '@core/domain/logs';
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
  let pending = call('log_environment')
    .then((value) => {
      if (value && typeof value === 'object') {
        const fields = value as Record<string, unknown>;
        for (const key of ['sessionId', 'platform', 'appVersion', 'gitVersion'] as const) {
          if (typeof fields[key] === 'string') environment[key] = fields[key];
        }
      }
    })
    .catch(() => undefined);
  return {
    setDebugEnabled: (enabled) => {
      debugEnabled = enabled;
    },
    write: (level: LogLevel, scope, message, detail, context) => {
      if (level === 'debug' && !debugEnabled) return;
      const entry = makeEntry(level, scope, message, debugEnabled, detail, context);
      notify(entry);
      pending = pending
        .then(async () => {
          Object.assign(entry, environment);
          await call('log_append', { entry });
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
              ),
              ...environment,
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
    },
    openDirectory: async () => {
      await call('log_open_directory');
    },
  };
}
