import { GitOperationError, OperationCancelledError } from '@core/domain/errors';
import { describe, expect, it, vi } from 'vitest';
import { createMockGitPort } from './mock/mockGitPort';
import { createMockLogPort } from './mock/mockLogPort';
import { instrumentGitPort } from './instrumentGitPort';
import { createTauriGitPort } from './tauri/tauriGitPort';

describe('instrumentGitPort', () => {
  it('debug correlaciona lectura, duración y cantidades sin contenidos', async () => {
    const log = createMockLogPort({ debugEnabled: true });
    await instrumentGitPort(createMockGitPort(), log).readStatus('gitthul');
    const entries = await log.read({ scope: 'git.read' });
    expect(entries.map((entry) => entry.context?.phase)).toEqual(['success']);
    expect(entries[0]?.context?.repository).toBe('gitthul');
    expect(entries[0]?.context?.durationMs).toBeGreaterThanOrEqual(0);
    expect(entries[0]?.context?.startedAt).toBeGreaterThan(0);
    expect(entries[0]?.context?.result).toContain('staged=');
    expect(entries[0]?.context?.resultData?.['stagedCount']).toBeTypeOf('number');
    expect(entries[0]?.context?.operationId).toBeTypeOf('string');
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
      schemaVersion: 3,
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
    expect(entries[0]?.context?.error).toMatchObject({
      code: 'unknown',
      cause: { message: 'disco no disponible' },
    });
    expect(entries[0]?.context?.requestData?.['options.expectedBranch']).toBe('main');
  });

  it('conserva el diagnóstico nativo de referencias en los registros normales y redacta credenciales', async () => {
    const log = createMockLogPort();
    const output =
      'leer remoto origin: URL inválida https://user:private@example.invalid/repo?token=hidden';
    const call = vi.fn().mockRejectedValue({ code: 'unknown', params: {}, output });
    const git = instrumentGitPort(createTauriGitPort(call), log);

    await expect(git.readRefs('repo')).rejects.toMatchObject({ code: 'unknown', output });
    expect(call).toHaveBeenCalledWith('git_read_refs', { id: 'repo' });
    const entries = await log.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'error',
      context: { repository: 'repo', method: 'readRefs', phase: 'failure' },
    });
    expect(entries[0]?.detail).toContain('leer remoto origin: URL inválida');
    expect(entries[0]?.detail).toContain('[redacted]');
    expect(JSON.stringify(entries)).not.toContain('user:private');
    expect(JSON.stringify(entries)).not.toContain('token=hidden');
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
    expect((await log.read())[0]?.detail).toContain('circular reference');
    expect((await log.read())[0]?.context?.error?.message).toBe('falló la operación');
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

  it('captura comandos nativos y la causa estructurada con una correlación consultable', async () => {
    const log = createMockLogPort();
    const diagnostic = {
      diagnosticId: 'native-42',
      kind: 'git',
      stage: 'load_history',
      command: { program: 'git', args: ['log', '--all'] },
      exitCode: 128,
      stderr: 'fatal: corrupt object',
    };
    const call = vi.fn().mockRejectedValue({
      code: 'unknown',
      params: {},
      output: 'fatal: corrupt object',
      diagnostic,
    });
    await expect(
      instrumentGitPort(createTauriGitPort(call), log).readCommits('repo'),
    ).rejects.toThrow();
    expect((await log.read())[0]?.context).toMatchObject({
      nativeOperationId: 'native-42',
      error: { diagnostic },
    });
  });

  it('incluye las operaciones previas del mismo repositorio aunque debug esté desactivado', async () => {
    const log = createMockLogPort();
    const source = createMockGitPort();
    vi.spyOn(source, 'readStatus').mockResolvedValue({
      staged: [],
      unstaged: [],
      conflicted: [],
    } as never);
    vi.spyOn(source, 'readTree').mockRejectedValueOnce(new Error('missing tree'));
    const git = instrumentGitPort(source, log);
    await git.readStatus('other');
    await git.readStatus('repo');
    await expect(git.readTree('repo')).rejects.toThrow('missing tree');
    const context = (await log.read())[0]?.context;
    expect(context?.recentOperations).toEqual([
      expect.objectContaining({ method: 'readStatus', repository: 'repo', phase: 'success' }),
    ]);
    expect(JSON.stringify(context?.recentOperations)).not.toContain('other');
    expect(JSON.stringify(context?.recentOperations)).not.toContain('staged');
  });

  it('no filtra texto libre si Git lo repite en output, causas o argumentos del diagnóstico', async () => {
    const log = createMockLogPort();
    const source = createMockGitPort();
    const summary = 'private business summary';
    const body = 'private business body\nwith detail';
    const error = new GitOperationError(
      'unknown',
      {},
      {
        output: `git commit -m ${summary} -m ${body}`,
        cause: new Error(`repeated ${body}`),
        diagnostic: { command: { program: 'git', args: ['commit', '-m', summary, '-m', body] } },
      },
    );
    vi.spyOn(source, 'commit').mockRejectedValueOnce(error);
    await expect(instrumentGitPort(source, log).commit('repo', { summary, body })).rejects.toBe(
      error,
    );
    const text = JSON.stringify(await log.read());
    expect(text).not.toContain(summary);
    expect(text).not.toContain('private business body');
    expect(text).toContain('git commit');
  });

  it('conserva el inicio visible de operaciones de red con correlación al resultado', async () => {
    const log = createMockLogPort();
    const source = createMockGitPort();
    vi.spyOn(source, 'fetch').mockResolvedValue({ branches: [] } as never);
    await instrumentGitPort(source, log).fetch('repo', 'origin', { prune: true });
    const entries = await log.read();
    expect(entries.map((entry) => entry.context?.phase)).toEqual(['start', 'success']);
    expect(entries[0]?.context?.operationId).toBe(entries[1]?.context?.operationId);
    expect(entries[0]?.context?.requestData?.['remote']).toBe('origin');
  });
});
