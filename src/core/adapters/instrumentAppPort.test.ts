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

  it('redacta secretos repetidos dentro del diagnóstico nativo estructurado', async () => {
    const log = createMockLogPort();
    const secret = 'a private keyring value';
    const error = {
      message: `keyring failed with ${secret}`,
      diagnostic: { stage: 'keyring_write', stderr: secret, cause: { secret } },
    };
    const source = { set: vi.fn().mockRejectedValueOnce(error) };
    await expect(instrumentAppPort(source, 'keyring', log).set('reference', secret)).rejects.toBe(
      error,
    );
    const entries = await log.read();
    expect(entries[0]?.context?.error?.diagnostic).toMatchObject({
      stage: 'keyring_write',
      stderr: '[redacted]',
    });
    expect(JSON.stringify(entries)).not.toContain(secret);
  });

  it('la autenticación conserva correlación y tipo sin registrar prompts o nombres de usuario', async () => {
    const log = createMockLogPort({ debugEnabled: true });
    let listener: ((event: unknown) => void) | undefined;
    const source = {
      subscribe: (callback: (event: unknown) => void) => {
        listener = callback;
        return Promise.resolve(() => undefined);
      },
    };
    const onChallenge = vi.fn();
    await instrumentAppPort(source, 'auth', log).subscribe(onChallenge);
    const event = {
      repository: 'repo',
      operationId: 'native-operation',
      kind: 'https',
      url: 'https://name:password@host/repo',
      prompt: 'private prompt',
      username: 'private person',
    };
    listener?.(event);
    expect(onChallenge).toHaveBeenCalledWith(event);
    expect((await log.read()).at(-1)?.context).toMatchObject({
      repository: 'repo',
      nativeOperationId: 'native-operation',
      requestData: { kind: 'https' },
    });
    const text = JSON.stringify(await log.read());
    for (const privateText of ['private prompt', 'private person', 'name:password'])
      expect(text).not.toContain(privateText);
  });

  it('una consulta de versiones indica su alcance estable sin parámetros obsoletos', async () => {
    const log = createMockLogPort({ debugEnabled: true });
    await instrumentAppPort(
      { checkRelease: () => Promise.resolve(null) },
      'link',
      log,
    ).checkRelease();
    const entry = (await log.read())[0];
    expect(entry?.context?.requestData).toEqual({ releaseKind: 'stable' });
    expect(JSON.stringify(entry)).not.toContain('undefined');
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
