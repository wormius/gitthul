import { boundLogText, redactLogText, redactLogValue } from '@core/domain/logPrivacy';
import { atLeast, type LogEntry, type LogMetadata, type LogValue } from '@core/domain/logs';
import { logEntryFactory } from './logEntry';

const INCIDENT_GROUP_LIMIT = 50;

interface ExportOptions {
  incidentsOnly?: boolean;
  debugEnabled?: boolean;
  retention?: LogMetadata;
  makeEntry?: ReturnType<typeof logEntryFactory>;
}

function metadata(value: LogValue | undefined): LogMetadata | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

/** Legacy and current entries remain individual rows; export repeats capture-time redaction. */
function sanitized(entry: LogEntry): LogEntry {
  const safe: LogEntry = {
    id: entry.id,
    at: entry.at,
    level: entry.level,
    scope: boundLogText(redactLogText(entry.scope), 128),
    message: boundLogText(redactLogText(entry.message), 4000),
  };
  for (const field of ['schemaVersion', 'debugEnabled', 'origin'] as const)
    if (entry[field] !== undefined) Object.assign(safe, { [field]: entry[field] });
  for (const field of ['sessionId', 'appVersion', 'platform', 'gitVersion'] as const)
    if (entry[field] !== undefined) safe[field] = boundLogText(redactLogText(entry[field]), 10000);
  if (entry.detail !== undefined) safe.detail = boundLogText(redactLogText(entry.detail), 15000);
  if (entry.context !== undefined)
    safe.context = redactLogValue(entry.context) as unknown as LogEntry['context'];
  return safe;
}

function evidence(entry: LogEntry, diagnostic: LogMetadata | undefined): string {
  if (typeof diagnostic?.['stderr'] === 'string' && diagnostic['stderr'])
    return diagnostic['stderr'];
  const causes = diagnostic?.['causes'];
  if (causes !== undefined && causes !== null && (!Array.isArray(causes) || causes.length > 0))
    return JSON.stringify(causes);
  return entry.detail ?? '';
}

/** One INFO header describes exactly what was retained and selected, including incident exports. */
export function encodeLogExport(
  retained: readonly LogEntry[],
  options: ExportOptions = {},
): string {
  const entries = retained.map(sanitized);
  const selected = entries.filter(
    (entry) => !options.incidentsOnly || atLeast(entry.level, 'warn'),
  );
  const levels: LogMetadata = {};
  const sessions = new Set<string>();
  const groups = new Map<string, LogMetadata>();
  const omitted = new Set<string>();
  for (const entry of entries) {
    levels[entry.level] = Number(levels[entry.level] ?? 0) + 1;
    if (entry.sessionId !== undefined) sessions.add(entry.sessionId);
    if (!atLeast(entry.level, 'warn')) continue;
    const context = entry.context;
    const diagnostic = metadata(context?.error?.diagnostic);
    const method = context?.method ?? '';
    const code = context?.errorCode ?? '';
    const repository = context?.repository ?? '';
    const stage = typeof diagnostic?.['stage'] === 'string' ? diagnostic['stage'] : '';
    const exitCode = typeof diagnostic?.['exitCode'] === 'number' ? diagnostic['exitCode'] : null;
    const signal =
      typeof diagnostic?.['signal'] === 'number' || typeof diagnostic?.['signal'] === 'string'
        ? diagnostic['signal']
        : null;
    const originalEvidence = evidence(entry, diagnostic);
    const key = JSON.stringify([
      entry.scope,
      method,
      code,
      repository,
      stage,
      exitCode,
      signal,
      originalEvidence,
    ]);
    const existing = groups.get(key);
    if (existing) {
      existing['count'] = Number(existing['count']) + 1;
      existing['firstAt'] = Math.min(Number(existing['firstAt']), entry.at);
      existing['lastAt'] = Math.max(Number(existing['lastAt']), entry.at);
    } else if (groups.size < INCIDENT_GROUP_LIMIT) {
      groups.set(key, {
        scope: entry.scope,
        method,
        errorCode: code,
        repository,
        stage,
        evidence: boundLogText(originalEvidence, 2000),
        ...(exitCode === null ? {} : { exitCode }),
        ...(signal === null ? {} : { signal }),
        sampleOperationId: context?.operationId ?? '',
        sampleNativeOperationId:
          context?.nativeOperationId ??
          (typeof diagnostic?.['diagnosticId'] === 'string' ? diagnostic['diagnosticId'] : ''),
        sampleMessage: boundLogText(entry.message, 1000),
        count: 1,
        firstAt: entry.at,
        lastAt: entry.at,
      });
    } else omitted.add(key);
  }
  const report: LogMetadata = {
    format: 'GitThul JSONL diagnostic report',
    schemaVersion: 3,
    mode: options.incidentsOnly ? 'incidents' : 'all',
    entriesRetained: entries.length,
    entriesExported: selected.length,
    sessionCount: sessions.size,
    levels,
    firstAt: entries.length ? Math.min(...entries.map((entry) => entry.at)) : null,
    lastAt: entries.length ? Math.max(...entries.map((entry) => entry.at)) : null,
    incidentGroups: [...groups.values()].map((group) => redactLogValue(group)),
    incidentGroupsOmittedCount: omitted.size,
    incidentGroupLimit: INCIDENT_GROUP_LIMIT,
    retention: redactLogValue(options.retention ?? {}),
    scope: 'Only retained entries are available; normal mode omits routine successes.',
  };
  const makeEntry = options.makeEntry ?? logEntryFactory();
  const summary = makeEntry(
    'info',
    'diagnostic.report',
    'Resumen del reporte de diagnóstico',
    options.debugEnabled ?? false,
  );
  // The report is generated and each group redacted separately, so a 50-group header is not
  // silently shortened by the per-operation metadata budget or its 30-item array limit.
  summary.id = 0;
  summary.context = { report };
  return [summary, ...selected].map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}
