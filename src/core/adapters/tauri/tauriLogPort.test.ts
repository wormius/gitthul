import { describe, expect, it, vi } from 'vitest';

import type { LogEntry } from '@core/domain/logs';

import { createTauriLogPort } from './tauriLogPort';
import { logOperation } from '../logOperation';

describe('createTauriLogPort', () => {
  it('escribe, avisa, lee, filtra y abre la carpeta mediante el backend', async () => {
    const stored: LogEntry[] = [];
    const call = vi.fn((command: string, args?: Record<string, unknown>) => {
      if (command === 'log_append') stored.push(args?.['entry'] as LogEntry);
      if (command === 'log_read') return Promise.resolve(stored);
      return Promise.resolve(undefined);
    });
    const log = createTauriLogPort(call);
    const listener = vi.fn();
    log.subscribe(listener);

    log.write('info', 'app', 'arrancó');
    log.write('error', 'git.write', 'falló', 'detalle');
    await vi.waitFor(() => expect(stored).toHaveLength(2));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(await log.read({ minLevel: 'warn' })).toMatchObject([
      { level: 'error', scope: 'git.write', detail: 'detalle' },
    ]);
    await log.openDirectory();
    await log.clear();
    expect(call).toHaveBeenCalledWith('log_open_directory');
    expect(call).toHaveBeenCalledWith('log_clear');
  });
});

it('descarta debug antes de IPC y de las suscripciones, y respeta los cambios en caliente', async () => {
  const call = vi.fn().mockResolvedValue(undefined);
  const log = createTauriLogPort(call);
  const listener = vi.fn();
  log.subscribe(listener);
  log.write('debug', 'git.read', 'hidden');
  log.setDebugEnabled(true);
  log.write('debug', 'git.read', 'visible');
  log.setDebugEnabled(false);
  log.write('debug', 'git.read', 'hidden again');
  await log.read();
  expect(listener).toHaveBeenCalledTimes(1);
  expect(call.mock.calls.filter(([name]) => name === 'log_append')).toHaveLength(1);
});

it('incluye entorno nativo y Git en cada entrada persistida', async () => {
  const stored: LogEntry[] = [];
  const call = vi.fn((name: string, args?: Record<string, unknown>) => {
    if (name === 'log_environment')
      return Promise.resolve({
        platform: 'linux x86_64',
        sessionId: 'native-session',
        gitVersion: 'git version 2.50',
        environment: { os: 'linux', glibc: '2.35', password: 'hidden' },
      });
    if (name === 'log_append') stored.push(args?.['entry'] as LogEntry);
    return Promise.resolve(stored);
  });
  const log = createTauriLogPort(call);
  const notified: LogEntry[] = [];
  log.subscribe((entry) => notified.push(structuredClone(entry)));
  log.write('error', 'git.write', 'failed');
  await log.read();
  expect(stored[0]).toMatchObject({
    platform: 'linux x86_64',
    sessionId: 'native-session',
    gitVersion: 'git version 2.50',
    context: { environment: { os: 'linux', glibc: '2.35', password: '[redacted]' } },
  });
  expect(notified[0]).toEqual(stored[0]);
});

it('no bloquea operaciones al fallar el disco; conserva la advertencia al recuperarse', async () => {
  const stored: LogEntry[] = [];
  let broken = true;
  const call = vi.fn((name: string, args?: Record<string, unknown>) => {
    if (name === 'log_append') {
      if (broken) return Promise.reject(new Error('disk full'));
      stored.push(args?.['entry'] as LogEntry);
    }
    if (name === 'log_read') return Promise.resolve(stored);
    return Promise.resolve(true);
  });
  const log = createTauriLogPort(call);
  const listener = vi.fn();
  log.subscribe(listener);
  log.subscribe(() => {
    throw new Error('subscriber failed');
  });
  expect(() => log.write('error', 'runtime', 'lost event')).not.toThrow();
  expect((await log.read())[0]).toMatchObject({ level: 'error', scope: 'logging' });
  broken = false;
  log.write('info', 'app', 'next event');
  await log.export(true);
  expect(stored.some((entry) => entry.scope === 'logging')).toBe(true);
  expect(call).toHaveBeenLastCalledWith('log_export', { errorsOnly: true });
});

it('cuenta dos registros perdidos y publica una advertencia actualizada que se conserva al recuperarse', async () => {
  const stored: LogEntry[] = [];
  const notifications: LogEntry[] = [];
  let broken = true;
  const call = vi.fn((name: string, args?: Record<string, unknown>) => {
    if (name === 'log_append') {
      if (broken) return Promise.reject(new Error('disk full'));
      stored.push(args?.['entry'] as LogEntry);
    }
    return Promise.resolve(name === 'log_read' ? stored : true);
  });
  const log = createTauriLogPort(call);
  log.subscribe((entry) => notifications.push(entry));
  log.write('error', 'git.read', 'first lost event');
  log.write('error', 'git.read', 'second lost event');
  const failed = await log.read();
  expect(failed).toHaveLength(1);
  expect(failed[0]?.context?.report?.['lostEntries']).toBe(2);
  const failures = notifications.filter((entry) => entry.scope === 'logging');
  expect(failures.map((entry) => entry.context?.report?.['lostEntries'])).toEqual([1, 2]);
  expect(failures[0]?.id).toBe(failures[1]?.id);
  expect(failures[0]).not.toBe(failures[1]);
  broken = false;
  log.write('info', 'app', 'storage recovered');
  const recovered = await log.read();
  expect(recovered.map((entry) => entry.scope)).toEqual(['app', 'logging']);
  expect(stored.filter((entry) => entry.scope === 'logging')).toHaveLength(1);
  expect(stored.at(-1)?.context?.report?.['lostEntries']).toBe(2);
  await log.export(true);
  expect(call).toHaveBeenLastCalledWith('log_export', { errorsOnly: true });
});

it('no suma como perdido un registro guardado si sólo falla persistir la advertencia', async () => {
  const stored: LogEntry[] = [];
  let phase: 'failure' | 'warning-failure' | 'recovered' = 'failure';
  const call = vi.fn((name: string, args?: Record<string, unknown>) => {
    if (name === 'log_append') {
      const entry = args?.['entry'] as LogEntry;
      if (phase === 'failure' || (phase === 'warning-failure' && entry.scope === 'logging'))
        return Promise.reject(new Error('disk unavailable'));
      stored.push(entry);
    }
    return Promise.resolve(name === 'log_read' ? stored : true);
  });
  const log = createTauriLogPort(call);
  log.write('error', 'git.read', 'lost');
  await log.read();
  phase = 'warning-failure';
  log.write('info', 'app', 'saved');
  const pending = await log.read();
  expect(pending.find((entry) => entry.scope === 'logging')?.context?.report?.['lostEntries']).toBe(
    1,
  );
  expect(stored).toHaveLength(1);
  phase = 'recovered';
  log.write('info', 'app', 'saved again');
  await log.read();
  expect(stored.at(-1)?.context?.report?.['lostEntries']).toBe(1);
});

it('espera el entorno para publicar una identidad estable y redacta también sus campos nativos', async () => {
  const stored: LogEntry[] = [];
  const notified: LogEntry[] = [];
  let release: ((value: unknown) => void) | undefined;
  const environment = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const call = vi.fn((name: string, args?: Record<string, unknown>) => {
    if (name === 'log_environment') return environment;
    if (name === 'log_append') stored.push(args?.['entry'] as LogEntry);
    return Promise.resolve(name === 'log_read' ? stored : true);
  });
  const log = createTauriLogPort(call);
  log.subscribe((entry) => notified.push(entry));
  log.write('error', 'git.read', 'failed');
  expect(notified).toHaveLength(0);
  release?.({
    sessionId: 'native-session',
    platform: 'linux https://name:password@host/path',
    gitVersion: 'git version 2.50 Bearer private-token',
    environment: {
      nested: { authorization: 'private credential', url: 'https://name:password@host/repo' },
    },
  });
  await log.read();
  expect(notified).toHaveLength(1);
  const snapshot = structuredClone(notified[0]);
  expect(snapshot).toEqual(stored[0]);
  expect(snapshot?.sessionId).toBe('native-session');
  expect(snapshot?.context?.environment).toMatchObject({ nested: { authorization: '[redacted]' } });
  for (const secret of ['name:password', 'private-token', 'private credential'])
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  log.write('info', 'app', 'next');
  await log.read();
  expect(notified[0]).toEqual(snapshot);
});

it('el entorno añadido respeta el límite nativo de metadatos sin quitar el error prioritario', async () => {
  const stored: LogEntry[] = [];
  const call = vi.fn((name: string, args?: Record<string, unknown>) => {
    if (name === 'log_environment')
      return Promise.resolve({
        gitVersion: '🦑'.repeat(300),
        environment: { os: 'linux', libraries: '🦑'.repeat(20000) },
      });
    if (name === 'log_append') {
      const entry = args?.['entry'] as LogEntry;
      if (new TextEncoder().encode(JSON.stringify(entry.context)).length > 65536)
        return Promise.reject(new Error('invalid native context'));
      stored.push(entry);
    }
    return Promise.resolve(name === 'log_read' ? stored : true);
  });
  const log = createTauriLogPort(call);
  log.write('error', 'git.read', 'failed', undefined, {
    requestData: { paths: '🦑'.repeat(20000) },
    error: { code: 'unknown', diagnostic: { stage: 'read_refs', stderr: 'fatal: object missing' } },
  });
  await log.read();
  expect(stored).toHaveLength(1);
  expect(stored[0]?.scope).toBe('git.read');
  expect(stored[0]?.context?.error?.diagnostic).toMatchObject({
    stage: 'read_refs',
    stderr: 'fatal: object missing',
  });
  expect(new TextEncoder().encode(stored[0]?.gitVersion).length).toBeLessThanOrEqual(128);
  expect(stored[0]?.gitVersion).toContain('[truncated]');
});

it('vaciar el registro nativo borra las pistas anteriores incluidas en la siguiente incidencia', async () => {
  const stored: LogEntry[] = [];
  const call = vi.fn((name: string, args?: Record<string, unknown>) => {
    if (name === 'log_append') stored.push(args?.['entry'] as LogEntry);
    if (name === 'log_clear') stored.length = 0;
    return Promise.resolve(name === 'log_read' ? stored : true);
  });
  const log = createTauriLogPort(call);
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
