import { GitOperationError, OperationCancelledError } from '@core/domain/errors';
import { describe, expect, it, vi } from 'vitest';
import { createMockGitPort } from './mock/mockGitPort';
import { createMockLogPort } from './mock/mockLogPort';
import { instrumentGitPort } from './instrumentGitPort';

describe('instrumentGitPort', () => {
  it('debug correlaciona lectura, duración y cantidades sin contenidos', async () => {
    const log = createMockLogPort({ debugEnabled: true });
    await instrumentGitPort(createMockGitPort(), log).readStatus('gitthul');
    const entries = await log.read({ scope: 'git.read' });
    expect(entries.map((entry) => entry.context?.phase)).toEqual(['start', 'success']);
    expect(entries[0]?.context?.repository).toBe('gitthul');
    expect(entries[1]?.context?.durationMs).toBeGreaterThanOrEqual(0);
    expect(entries[1]?.context?.result).toContain('staged=');
    expect(entries[0]?.context?.operationId).toBe(entries[1]?.context?.operationId);
  });

  it('el modo normal omite lecturas y pasos rutinarios', async () => {
    const log = createMockLogPort();
    const git = instrumentGitPort(createMockGitPort(), log);
    await git.readStatus('gitthul');
    await git.previewIntegration('gitthul', 'merge', 'main', 'main');
    expect(await log.read()).toEqual([]);
  });

  it('un error desconocido conserva diagnóstico, metadatos y petición sin depender de debug', async () => {
    const log = createMockLogPort();
    const source = createMockGitPort();
    const cause = new Error('disco no disponible');
    const error = new GitOperationError(
      'unknown',
      {},
      {
        output: 'fatal: https://user:secret@example.com/repo?token=private failed',
        cause,
      },
    );
    vi.spyOn(source, 'reset').mockRejectedValueOnce(error);
    await expect(
      instrumentGitPort(source, log).reset('repo', 'abc123', 'hard', {
        expectedBranch: 'main',
        precondition: { head: 'old', indexTree: 'index', worktreeTree: 'work' },
      }),
    ).rejects.toBe(error);
    const entries = await log.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'error',
      schemaVersion: 2,
      context: { repository: 'repo', method: 'reset', phase: 'failure', errorCode: 'unknown' },
    });
    expect(typeof entries[0]?.sessionId).toBe('string');
    expect(typeof entries[0]?.appVersion).toBe('string');
    expect(typeof entries[0]?.platform).toBe('string');
    expect(entries[0]?.context?.request).toContain('expectedBranch=main');
    expect(entries[0]?.detail).toContain('fatal:');
    expect(entries[0]?.detail).toContain('disco no disponible');
    expect(entries[0]?.detail).not.toContain('user:secret');
    expect(entries[0]?.detail).not.toContain('token=private');
  });

  it.each(['write.stale', 'merge.conflict', 'auth.failed'] as const)(
    'clasifica %s como aviso recuperable',
    async (code) => {
      const log = createMockLogPort();
      const source = createMockGitPort();
      const error =
        code === 'write.stale'
          ? new GitOperationError(code, { path: 'WIP' })
          : code === 'merge.conflict'
            ? new GitOperationError(code, { source: 'dev', target: 'main', count: 1 })
            : new GitOperationError(code, { remote: 'origin' });
      vi.spyOn(source, 'readStatus').mockRejectedValueOnce(error);
      await expect(instrumentGitPort(source, log).readStatus('repo')).rejects.toBe(error);
      expect((await log.read())[0]).toMatchObject({ level: 'warn', context: { errorCode: code } });
    },
  );

  it('no registra texto libre de stash, identidad o archivos resueltos', async () => {
    const log = createMockLogPort({ debugEnabled: true });
    const source = createMockGitPort();
    vi.spyOn(source, 'createStash').mockResolvedValueOnce({} as never);
    vi.spyOn(source, 'resolveConflict').mockResolvedValueOnce({} as never);
    vi.spyOn(source, 'writeIdentity').mockResolvedValueOnce({
      name: 'Private Person',
      email: 'private@host',
    });
    const git = instrumentGitPort(source, log);
    await git.createStash('repo', 'private stash text');
    await git.resolveConflict('repo', 'file.txt', 'private file contents');
    await git.writeIdentity('repo', { name: 'Private Person', email: 'private@host' });
    const entries = JSON.stringify(await log.read());
    for (const secret of [
      'private stash text',
      'private file contents',
      'Private Person',
      'private@host',
    ])
      expect(entries).not.toContain(secret);
    expect(entries).toContain('file.txt');
  });

  it('un error con causas cíclicas conserva el rechazo original', async () => {
    const log = createMockLogPort();
    const source = createMockGitPort();
    const cause: Record<string, unknown> = {};
    cause['self'] = cause;
    const error = new Error('falló la operación', { cause });
    vi.spyOn(source, 'readStatus').mockRejectedValueOnce(error);
    await expect(instrumentGitPort(source, log).readStatus('repo')).rejects.toBe(error);
    expect((await log.read())[0]?.detail).toContain('unserializable error');
  });

  it('la comprobación automática sin resoluciones no agrega hitos en modo normal', async () => {
    const log = createMockLogPort();
    const source = createMockGitPort();
    vi.spyOn(source, 'autoResolve').mockResolvedValueOnce({ resolved: [], status: {} } as never);
    await instrumentGitPort(source, log).autoResolve('repo');
    expect(await log.read()).toEqual([]);
  });

  it('mantiene la cancelación fuera de los avisos y errores', async () => {
    const log = createMockLogPort({ debugEnabled: true });
    const source = createMockGitPort();
    vi.spyOn(source, 'readStatus').mockRejectedValueOnce(new OperationCancelledError());
    await expect(instrumentGitPort(source, log).readStatus('repo')).rejects.toThrow();
    expect(await log.read({ minLevel: 'warn' })).toHaveLength(0);
    expect((await log.read()).at(-1)?.context?.phase).toBe('cancelled');
  });
});
