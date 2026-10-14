import { logEntryFactory } from '../logEntry';
import { atLeast, type LogEntry, type LogFilter } from '@core/domain/logs';
import type { LogPort } from '@core/ports/LogPort';
import { clearOperationHistory } from '../logOperation';
import { encodeLogExport } from '../logExport';

export interface MockLogPortOptions {
  /** Cuántas entradas se conservan. Las viejas se van por el otro extremo. */
  capacity?: number;
  /** Además de guardarlas, escribirlas en la consola del navegador. */
  echo?: boolean;
  debugEnabled?: boolean;
}

const DEFAULT_CAPACITY = 2000;

/**
 * Registros en memoria.
 *
 * Un anillo con tope: una sesión larga con el modo de depuración encendido
 * puede producir decenas de miles de líneas, y quedarse sin memoria por guardar
 * el historial completo de lo que solo sirve para depurar sería absurdo. El
 * visor muestra las entradas retenidas.
 */
export function createMockLogPort(options: MockLogPortOptions = {}): LogPort {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const entries: LogEntry[] = [];
  const listeners = new Set<(entry: LogEntry) => void>();

  let debugEnabled = options.debugEnabled ?? false;
  const makeEntry = logEntryFactory();

  const port: LogPort = {
    setDebugEnabled: (enabled) => {
      debugEnabled = enabled;
    },
    write: (level, scope, message, detail, context) => {
      if (level === 'debug' && !debugEnabled) return;
      const entry = makeEntry(level, scope, message, debugEnabled, detail, context);
      entries.push(entry);

      if (entries.length > capacity) entries.splice(0, entries.length - capacity);

      if (options.echo) console[level](`[${entry.scope}] ${entry.message}`, entry.detail ?? '');

      for (const listener of listeners) {
        try {
          listener(entry);
        } catch {
          /* Isolate subscribers. */
        }
      }
    },

    read: (filter: LogFilter = {}) => {
      let found = entries;

      if (filter.minLevel) {
        const minimum = filter.minLevel;

        found = found.filter((entry) => atLeast(entry.level, minimum));
      }

      if (filter.scope !== undefined) found = found.filter((entry) => entry.scope === filter.scope);

      return Promise.resolve(filter.limit === undefined ? [...found] : found.slice(-filter.limit));
    },

    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    export: (errorsOnly = false) => {
      const url = URL.createObjectURL(
        new Blob(
          [
            encodeLogExport(entries, {
              incidentsOnly: errorsOnly,
              debugEnabled,
              retention: { capacityEntries: capacity },
              makeEntry,
            }),
          ],
          {
            type: 'application/x-ndjson',
          },
        ),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = errorsOnly ? 'gitthul-incidents.jsonl' : 'gitthul-logs.jsonl';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return Promise.resolve(true);
    },
    clear: () => {
      entries.length = 0;
      clearOperationHistory(port);

      return Promise.resolve();
    },

    openDirectory: () => Promise.resolve(),
  };
  return port;
}
