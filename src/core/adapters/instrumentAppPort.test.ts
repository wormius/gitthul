import { describe, expect, it, vi } from 'vitest';
import { createMockLogPort } from './mock/mockLogPort';
import { instrumentAppPort } from './instrumentAppPort';

describe('instrumentAppPort', () => {
  it('registra errores de credenciales sin filtrar secretos aunque el backend los repita', async () => {
    const log = createMockLogPort({ debugEnabled: true });
    const secret = 'arbitrary private value\nwith newline';
    const error = new Error(`failure: ${secret}`);
    const source = { set: vi.fn().mockRejectedValue(error) };
    await expect(instrumentAppPort(source, 'keyring', log).set('ref', secret)).rejects.toBe(error);
    const entries = await log.read();
    expect(entries.at(-1)).toMatchObject({
      level: 'error',
      scope: 'keyring',
      context: { method: 'set' },
    });
    expect(JSON.stringify(entries)).not.toContain('arbitrary private value');
  });

  it('no incluye contenido de ajustes, portapapeles o historial en debug', async () => {
    const log = createMockLogPort({ debugEnabled: true });
    const source = { readClipboardText: () => Promise.resolve('private clipboard') };
    await expect(instrumentAppPort(source, 'system', log).readClipboardText()).resolves.toBe(
      'private clipboard',
    );
    expect(JSON.stringify(await log.read())).not.toContain('private clipboard');
  });

  it('captura fallos síncronos con el rechazo original', async () => {
    const log = createMockLogPort();
    const failure = new Error('disk full');
    const port = instrumentAppPort(
      {
        write: () => {
          throw failure;
        },
      },
      'session',
      log,
    );
    await expect(port.write()).rejects.toBe(failure);
    expect((await log.read())[0]?.detail).toContain('disk full');
  });

  it('no registra pulsaciones ni redimensiones del terminal, incluso en debug', async () => {
    const log = createMockLogPort({ debugEnabled: true });
    const source = {
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
    };
    const terminal = instrumentAppPort(source, 'terminal', log);
    await terminal.write('session', 'private terminal');
    await terminal.resize('session', 80, 24);
    expect(await log.read()).toEqual([]);
    source.write.mockRejectedValueOnce(new Error('PTY unavailable'));
    await expect(terminal.write('session', 'private terminal')).rejects.toThrow();
    expect((await log.read())[0]).toMatchObject({
      level: 'error',
      context: { request: 'sessionId=session' },
    });
  });
});

it('cerrar deliberadamente el terminal no crea avisos por la señal de salida', async () => {
  const log = createMockLogPort();
  let exit:
    ((value: { code: number; signal: string | null; success: boolean }) => void) | undefined;
  const source = {
    createSession: (request: {
      sessionId: string;
      cwd: string;
      cols: number;
      rows: number;
      onExit?: typeof exit;
    }) => {
      exit = request.onExit;
      return Promise.resolve();
    },
    closeSession: (_sessionId: string) => Promise.resolve(),
  };
  const port = instrumentAppPort(source, 'terminal', log);
  await port.createSession({ sessionId: 'test', cwd: '/repo', cols: 80, rows: 24 });
  await port.closeSession('test');
  exit?.({ code: 1, signal: 'SIGKILL', success: false });
  expect(await log.read({ minLevel: 'warn' })).toEqual([]);
  await port.createSession({ sessionId: 'another', cwd: '/repo', cols: 80, rows: 24 });
  exit?.({ code: 1, signal: null, success: false });
  expect((await log.read({ minLevel: 'warn' }))[0]?.scope).toBe('terminal');
});
