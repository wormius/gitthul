import { describe, expect, it } from 'vitest';
import type { LogEntry, LogLevel, LogMetadata } from '@core/domain/logs';
import { encodeLogExport } from './logExport';

function entry(id: number, level: LogLevel = 'error', extra: Partial<LogEntry> = {}): LogEntry {
  return {
    id,
    at: 1000 + id,
    level,
    scope: 'git.read',
    message: 'falló leer refs',
    sessionId: 'test-session',
    context: {
      operationId: `op-${id}`,
      nativeOperationId: `native-${id}`,
      method: 'readRefs',
      repository: '/repo',
      errorCode: 'unknown',
      error: {
        diagnostic: { stage: 'enumerate_refs', stderr: 'fatal: corrupt reference', exitCode: 128 },
      },
    },
    ...extra,
  };
}

function rows(text: string): LogEntry[] {
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LogEntry);
}

function groups(header: LogEntry | undefined): LogMetadata[] {
  return header?.context?.report?.['incidentGroups'] as LogMetadata[];
}

describe('encodeLogExport', () => {
  it('antepone un resumen al reporte completo y conserva todas las filas originales', () => {
    const retained = [entry(1, 'debug'), entry(2, 'info'), entry(3, 'warn'), entry(4, 'error')];
    const output = rows(encodeLogExport(retained, { retention: { capacityEntries: 2000 } }));
    expect(output[0]).toMatchObject({
      id: 0,
      level: 'info',
      scope: 'diagnostic.report',
      schemaVersion: 3,
      context: {
        report: {
          mode: 'all',
          entriesRetained: 4,
          entriesExported: 4,
          sessionCount: 1,
          firstAt: 1001,
          lastAt: 1004,
          levels: { debug: 1, info: 1, warn: 1, error: 1 },
          retention: { capacityEntries: 2000 },
        },
      },
    });
    expect(output.slice(1)).toEqual(retained);
    expect(groups(output[0])).toEqual([
      expect.objectContaining({
        method: 'readRefs',
        repository: '/repo',
        stage: 'enumerate_refs',
        evidence: 'fatal: corrupt reference',
        count: 2,
        firstAt: 1003,
        lastAt: 1004,
        exitCode: 128,
        sampleOperationId: 'op-3',
        sampleNativeOperationId: 'native-3',
        sampleMessage: 'falló leer refs',
      }),
    ]);
    expect(output[0]?.context?.report?.['scope']).toContain('Only retained entries');
  });

  it('incluye el encabezado INFO también en incidencias y conserva su contexto autosuficiente', () => {
    const retained = [
      entry(1, 'debug'),
      entry(2, 'info'),
      entry(3, 'warn'),
      entry(4, 'error', { sessionId: 'second-session' }),
    ];
    const output = rows(encodeLogExport(retained, { incidentsOnly: true }));
    expect(output.map((row) => row.level)).toEqual(['info', 'warn', 'error']);
    expect(output[0]?.context?.report).toMatchObject({
      mode: 'incidents',
      entriesRetained: 4,
      entriesExported: 2,
      sessionCount: 2,
      levels: { debug: 1, info: 1, warn: 1, error: 1 },
    });
    expect(output.slice(1)).toEqual(retained.slice(2));
  });

  it('agrupa causas nativas iguales aunque sus trazas y operaciones cambien', () => {
    const diagnostic = {
      stage: 'read_config',
      causes: ['malformed section header', 'invalid config line'],
    };
    const retained = [
      entry(1, 'error', {
        detail: 'stack A operation one',
        context: { method: 'readRefs', error: { diagnostic } },
      }),
      entry(2, 'error', {
        detail: 'stack B operation two',
        context: { method: 'readRefs', error: { diagnostic } },
      }),
    ];
    const output = rows(encodeLogExport(retained));
    expect(groups(output[0])).toEqual([expect.objectContaining({ count: 2 })]);
    const evidence = groups(output[0])?.[0]?.['evidence'];
    if (typeof evidence !== 'string') throw new Error('expected textual diagnostic evidence');
    expect(JSON.parse(evidence)).toEqual(diagnostic.causes);
    expect(output.slice(1)).toHaveLength(2);
  });

  it('distingue causas, estados de salida y señales distintos sin quitar filas', () => {
    const retained = [128, 1].map((exitCode, index) =>
      entry(index + 1, 'error', {
        context: {
          method: 'readRefs',
          error: {
            diagnostic: { stage: 'enumerate_refs', stderr: 'same error text', exitCode, signal: 9 },
          },
        },
      }),
    );
    retained.push(
      entry(3, 'error', {
        context: {
          method: 'readRefs',
          error: { diagnostic: { stage: 'enumerate_refs', stderr: 'other error', exitCode: 128 } },
        },
      }),
    );
    const output = rows(encodeLogExport(retained));
    expect(groups(output[0])).toHaveLength(3);
    expect(groups(output[0])?.[0]).toMatchObject({ signal: 9, exitCode: 128 });
    expect(output.slice(1)).toEqual(retained);
  });

  it('marca los grupos fuera del límite manteniendo las 50 muestras y cada registro', () => {
    const retained = Array.from({ length: 51 }, (_, index) =>
      entry(index + 1, 'error', {
        detail: `unique failure ${index}`,
        context: { method: 'readRefs' },
      }),
    );
    retained.push({ ...retained[50]!, id: 99, at: 1099 });
    const output = rows(encodeLogExport(retained));
    expect(groups(output[0])).toHaveLength(50);
    expect(output[0]?.context?.report).toMatchObject({
      entriesExported: 52,
      incidentGroupLimit: 50,
      incidentGroupsOmittedCount: 1,
    });
    expect(output.slice(1)).toHaveLength(52);
  });

  it('redacta filas y muestras aunque procedan de registros antiguos sin saneamiento', () => {
    const retained = [
      entry(1, 'error', {
        message: 'fatal https://name:private@host/repo',
        detail: 'password="private passphrase"',
        context: {
          method: 'readRefs',
          error: {
            params: { access_token: 'private-token' },
            diagnostic: { stage: 'fetch', stderr: 'Authorization: Bearer hidden-credential' },
          },
        },
      }),
    ];
    const output = encodeLogExport(retained);
    for (const secret of [
      'name:private',
      'private passphrase',
      'private-token',
      'hidden-credential',
    ])
      expect(output).not.toContain(secret);
    expect(output).toContain('host/repo');
    expect(groups(rows(output)[0])?.[0]?.['evidence']).toContain('[redacted]');
  });

  it('un reporte vacío declara su alcance y no inventa fechas ni sesiones', () => {
    const output = rows(encodeLogExport([], { incidentsOnly: true }));
    expect(output).toHaveLength(1);
    expect(output[0]?.context?.report).toMatchObject({
      entriesRetained: 0,
      entriesExported: 0,
      sessionCount: 0,
      firstAt: null,
      lastAt: null,
      incidentGroups: [],
      incidentGroupsOmittedCount: 0,
    });
  });
});
