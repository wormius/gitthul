import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '@core/domain/logs';
import { logOperation } from '../logOperation';

import { createMockLogPort } from './mockLogPort';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function blobEntries(blob: Blob): Promise<LogEntry[]> {
  const reader = new FileReader();
  const text = await new Promise<string>((resolve, reject) => {
    reader.onerror = () => reject(new Error('could not read exported blob'));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('expected exported JSONL text'));
    };
    reader.readAsText(blob);
  });
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LogEntry);
}

describe('createMockLogPort', () => {
  it('guarda lo escrito y lo devuelve en orden', async () => {
    const log = createMockLogPort();

    log.write('info', 'git.read', 'recorriendo commits');
    log.write('error', 'git.write', 'push rechazado', 'error: failed to push some refs');

    const entries = await log.read();

    expect(entries.map((entry) => entry.message)).toEqual([
      'recorriendo commits',
      'push rechazado',
    ]);
    expect(entries[1]?.detail).toBe('error: failed to push some refs');
    expect(entries[0]?.id).toBeLessThan(entries[1]?.id ?? 0);
  });

  it('filtra por nivel mínimo y por ámbito', async () => {
    const log = createMockLogPort();

    log.setDebugEnabled(true);
    log.write('debug', 'git.read', 'uno');
    log.write('warn', 'git.read', 'dos');
    log.write('error', 'settings', 'tres');

    expect(await log.read({ minLevel: 'warn' })).toHaveLength(2);
    expect(await log.read({ scope: 'git.read' })).toHaveLength(2);
    expect(await log.read({ minLevel: 'warn', scope: 'settings' })).toHaveLength(1);
  });

  /*
   * Una sesión con el modo de depuración encendido produce decenas de miles de
   * líneas; quedarse sin memoria por guardarlas todas sería absurdo.
   */
  it('tira las viejas al llegar al tope', async () => {
    const log = createMockLogPort({ capacity: 3 });

    for (const message of ['uno', 'dos', 'tres', 'cuatro']) log.write('info', 'app', message);

    expect((await log.read()).map((entry) => entry.message)).toEqual(['dos', 'tres', 'cuatro']);
  });

  it('avisa a quien escuche hasta que deja de escuchar', () => {
    const log = createMockLogPort();
    const listener = vi.fn();
    const stop = log.subscribe(listener);

    log.write('info', 'app', 'arrancó');

    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    log.write('info', 'app', 'y siguió');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('se puede vaciar', async () => {
    const log = createMockLogPort();

    log.write('info', 'app', 'algo');
    await log.clear();

    expect(await log.read()).toEqual([]);
  });

  it('exporta todas las filas o sólo incidencias con resumen INFO y secretos redactados', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', {
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return 'blob:report';
      },
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const log = createMockLogPort({ debugEnabled: true, capacity: 8 });
    log.write('debug', 'git.read', 'read completed');
    log.write('info', 'app', 'started');
    log.write('warn', 'git.read', 'needs attention');
    log.write('error', 'git.read', 'failed', 'https://name:password@host/repo', {
      method: 'readRefs',
      error: { diagnostic: { stage: 'read_refs', stderr: 'Bearer hidden-token' } },
    });
    const before = await log.read();
    const listener = vi.fn();
    log.subscribe(listener);
    vi.useFakeTimers();
    await expect(log.export()).resolves.toBe(true);
    await expect(log.export(true)).resolves.toBe(true);
    vi.runAllTimers();
    vi.useRealTimers();
    const all = await blobEntries(blobs[0]!);
    const incidents = await blobEntries(blobs[1]!);
    expect(all.slice(1)).toEqual(before);
    expect(incidents.map((entry) => entry.level)).toEqual(['info', 'warn', 'error']);
    expect(incidents[0]?.context?.report).toMatchObject({
      mode: 'incidents',
      entriesRetained: 4,
      entriesExported: 2,
      retention: { capacityEntries: 8 },
    });
    expect(all[0]?.scope).toBe('diagnostic.report');
    expect(JSON.stringify(all)).not.toContain('name:password');
    expect(JSON.stringify(all)).not.toContain('hidden-token');
    expect(await log.read()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('vaciar los registros elimina también las pistas anteriores adjuntas al siguiente error', async () => {
    const log = createMockLogPort();
    await logOperation(log, 'git.read', 'readStatus', 'leer estado', { repository: 'repo' }, () =>
      Promise.resolve(),
    );
    await log.clear();
    await expect(
      logOperation(log, 'git.read', 'readRefs', 'leer refs', { repository: 'repo' }, () =>
        Promise.reject(new Error('corrupt ref')),
      ),
    ).rejects.toThrow();
    expect((await log.read())[0]?.context?.recentOperations).toEqual([]);
  });
});
