import { describe, expect, it, vi } from 'vitest';
import { GitOperationError } from '@core/domain/errors';
import { createMockLogPort } from './mock/mockLogPort';
import { clearOperationHistory, errorDiagnostic, logOperation } from './logOperation';

describe('logOperation diagnostics', () => {
  it('registra el bloqueo de checkout como condición conocida y conserva el rechazo original', async () => {
    const log = createMockLogPort();
    const error = new GitOperationError(
      'branch.checkoutBlocked',
      { branch: 'rama' },
      {
        output: 'error: Your local changes would be overwritten by checkout',
      },
    );
    await expect(
      logOperation(log, 'git.write', 'createBranch', 'crear rama', { repository: '/repo' }, () => {
        throw error;
      }),
    ).rejects.toBe(error);
    const entries = await log.read();
    expect(entries).toMatchObject([
      {
        level: 'warn',
        context: {
          method: 'createBranch',
          errorCode: 'branch.checkoutBlocked',
          error: { params: { branch: 'rama' }, output: error.output },
        },
      },
    ]);
    expect(entries[0]?.message).toContain('crea un stash o haz commit');
  });
  it('registra el auto-stash conflictivo como condición conocida y permite recuperar', async () => {
    const log = createMockLogPort();
    const error = new GitOperationError('stash.autoConflict', { count: 2 });
    await expect(
      logOperation(log, 'git.write', 'continueOperation', 'continuar', {}, () =>
        Promise.reject(error),
      ),
    ).rejects.toBe(error);
    const entries = await log.read();
    expect(entries[0]).toMatchObject({
      level: 'warn',
      context: { errorCode: 'stash.autoConflict', recovery: 'openResolve, abortStashRestore' },
    });
    expect(entries[0]?.message).toContain('reaplicación del auto-stash dejó conflictos');
  });
  it('no reemplaza el resultado ni el rechazo aunque el destino o el resumen fallen', async () => {
    const log = createMockLogPort();
    vi.spyOn(log, 'write').mockImplementation(() => {
      throw new Error('logger unavailable');
    });
    const result = { state: 'unchanged' };
    await expect(
      logOperation(
        log,
        'test',
        'read',
        'leer',
        {},
        () => Promise.resolve(result),
        'info',
        () => {
          throw new Error('broken summary');
        },
      ),
    ).resolves.toBe(result);
    const error = new Error('original failure');
    await expect(
      logOperation(log, 'test', 'read', 'leer', {}, () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it('mantiene cada causa como objeto y conserva la primera causa ante un ciclo', () => {
    const first = new Error('first failure');
    const second = new Error('second failure', { cause: first });
    first.cause = second;
    expect(errorDiagnostic(first)).toMatchObject({
      message: 'first failure',
      cause: { message: 'second failure', cause: { message: '[circular reference]' } },
    });
  });

  it('un error con getter que falla no reemplaza el rechazo original', async () => {
    const log = createMockLogPort();
    const error = new Error('storage unavailable');
    Object.defineProperty(error, 'code', {
      get: () => {
        throw new Error('broken getter');
      },
    });
    await expect(
      logOperation(log, 'test', 'read', 'leer', {}, () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect((await log.read())[0]?.context?.error?.message).toBe('storage unavailable');
  });

  it('limitar las operaciones previas no elimina el contexto técnico de la incidencia', async () => {
    const log = createMockLogPort();
    for (let index = 0; index < 20; index++)
      await logOperation(log, 'git.read', `read-${index}`, 'leer', { repository: 'repo' }, () =>
        Promise.resolve(),
      );
    await expect(
      logOperation(log, 'git.read', 'readRefs', 'leer refs', { repository: 'repo' }, () =>
        Promise.reject(new Error('missing reference')),
      ),
    ).rejects.toThrow();
    const context = (await log.read())[0]?.context;
    expect(context?.recentOperations).toHaveLength(12);
    expect(context?.recentOperations?.[0]?.['method']).toBe('read-8');
    expect(context?.error?.message).toBe('missing reference');
  });

  it('borrar el historial del logger elimina también las pistas previas adjuntas', async () => {
    const log = createMockLogPort();
    await logOperation(log, 'git.read', 'readStatus', 'leer', { repository: 'repo' }, () =>
      Promise.resolve(),
    );
    clearOperationHistory(log);
    await expect(
      logOperation(log, 'git.read', 'readRefs', 'leer', { repository: 'repo' }, () =>
        Promise.reject(new Error('failed')),
      ),
    ).rejects.toThrow();
    expect((await log.read())[0]?.context?.recentOperations).toEqual([]);
  });
});
