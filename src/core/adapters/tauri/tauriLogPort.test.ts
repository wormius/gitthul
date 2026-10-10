import { describe, expect, it, vi } from 'vitest';

import type { LogEntry } from '@core/domain/logs';

import { createTauriLogPort } from './tauriLogPort';

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
      });
    if (name === 'log_append') stored.push(args?.['entry'] as LogEntry);
    return Promise.resolve(stored);
  });
  const log = createTauriLogPort(call);
  log.write('error', 'git.write', 'failed');
  await log.read();
  expect(stored[0]).toMatchObject({
    platform: 'linux x86_64',
    sessionId: 'native-session',
    gitVersion: 'git version 2.50',
  });
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
