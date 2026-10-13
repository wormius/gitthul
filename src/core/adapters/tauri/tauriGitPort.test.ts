import { describe, expect, it, vi } from 'vitest';

import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { GitOperationError, OperationCancelledError } from '@core/domain/errors';
import type { CommitDetails } from '@core/domain/commit';
import type { FileDiff } from '@core/domain/diff';
import type { RefsSnapshot } from '@core/domain/refs';
import type { Repository } from '@core/domain/repository';
import type { ConflictContents, WorkingStatus } from '@core/domain/status';

import { createTauriGitPort, decodeTauriGitError } from './tauriGitPort';

describe('tauriGitPort', () => {
  it('gestiona worktrees mediante comandos nativos sin usar el simulador', async () => {
    const fallback = createMockGitPort();
    const simulated = vi.spyOn(fallback, 'createWorktree');
    const call = vi.fn().mockResolvedValue({});
    const port = createTauriGitPort(fallback, call);
    const branch = { kind: 'branch' as const, name: 'topic' };
    await port.createWorktree('/repo', '/linked', branch);
    await port.lockWorktree('/repo', '/linked', true);
    await port.lockWorktree('/repo', '/linked', false);
    await port.removeWorktree('/repo', '/linked');
    expect(call.mock.calls).toEqual([
      ['git_create_worktree', { id: '/repo', path: '/linked', branch }],
      ['git_lock_worktree', { id: '/repo', path: '/linked', locked: true }],
      ['git_lock_worktree', { id: '/repo', path: '/linked', locked: false }],
      ['git_remove_worktree', { id: '/repo', path: '/linked', options: undefined }],
    ]);
    expect(simulated).not.toHaveBeenCalled();
  });

  it('delega el ciclo de vida a los comandos nativos', async () => {
    const repository = {
      id: '/repos/uno',
      name: 'uno',
      path: '/repos/uno',
      head: 'main',
      lastOpenedAt: 42,
      remotes: [],
      operation: { kind: 'none' as const },
      bare: false,
      hasSubmodules: false,
    };
    const call = vi.fn((command: string) =>
      Promise.resolve(command === 'git_list_repositories' ? [repository] : repository),
    );
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(port.listRepositories()).resolves.toEqual([repository]);
    await expect(port.openRepository('/repos/uno')).resolves.toEqual(repository);
    await expect(
      port.createRepository('/repos', { name: 'uno', initialBranch: 'trunk' }),
    ).resolves.toEqual(repository);
    await port.markOpened(repository.id, 42);
    await expect(port.readRepository(repository.id)).resolves.toEqual(repository);
    await port.forgetRepository(repository.id);

    expect(call.mock.calls).toEqual([
      ['git_list_repositories', undefined],
      ['git_open_repository', { path: '/repos/uno' }],
      [
        'git_create_repository',
        { path: '/repos', options: { name: 'uno', initialBranch: 'trunk' } },
      ],
      ['git_mark_opened', { id: '/repos/uno', at: 42 }],
      ['git_read_repository', { id: '/repos/uno' }],
      ['git_forget_repository', { id: '/repos/uno' }],
    ]);
  });

  it('rehidrata un error tipado que Rust serializó', async () => {
    const nativeError = Object.assign(new Error('rechazo serializado'), {
      code: 'repo.notARepository',
      params: { path: '/tmp/vacia' },
    });
    const port = createTauriGitPort(createMockGitPort(), () => Promise.reject(nativeError));

    const error = await port.openRepository('/tmp/vacia').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitOperationError);
    expect(error).toMatchObject({
      code: 'repo.notARepository',
      params: { path: '/tmp/vacia' },
    });
  });

  it('descarta una respuesta que llegó después de cancelar', async () => {
    const controller = new AbortController();
    const port = createTauriGitPort(createMockGitPort(), () => {
      controller.abort();
      return Promise.resolve([]);
    });

    await expect(port.listRepositories({ signal: controller.signal })).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
  });

  it('lee status nativo y conserva el contrato de dominio', async () => {
    const status: WorkingStatus = {
      staged: [
        {
          path: 'nombre nuevo.txt',
          previousPath: 'nombre anterior.txt',
          change: 'renamed',
          binary: false,
          insertions: 1,
          deletions: 1,
        },
      ],
      unstaged: [],
      conflicted: [],
      clean: false,
    };
    const call = vi.fn(() => Promise.resolve(status));
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(port.readStatus('/repos/uno')).resolves.toEqual(status);
    expect(call).toHaveBeenCalledWith('git_read_status', { id: '/repos/uno' });
  });

  it('lee las tres etapas de un conflicto en el comando nativo', async () => {
    const conflict: ConflictContents = {
      path: 'src/app.ts',
      kind: 'bothModified',
      base: 'base',
      ours: 'main',
      theirs: 'tema',
      oursLabel: 'main',
      theirsLabel: 'tema',
      sizes: { ours: { bytes: 4, lines: 1 }, theirs: { bytes: 4, lines: 1 } },
      binary: false,
      tooLarge: false,
    };
    const call = vi.fn(() => Promise.resolve(conflict));
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(port.readConflict('/repos/uno', conflict.path)).resolves.toEqual(conflict);
    expect(call).toHaveBeenCalledWith('git_read_conflict', {
      id: '/repos/uno',
      path: conflict.path,
    });
  });

  it('lee la foto completa de referencias en el comando nativo', async () => {
    const refs: RefsSnapshot = {
      head: { branch: 'main', sha: 'a'.repeat(40), detached: false },
      branches: [
        {
          id: 'refs/heads/main',
          name: 'main',
          kind: 'local',
          tip: 'a'.repeat(40),
          upstream: 'origin/main',
          ahead: 1,
          behind: 2,
          isHead: true,
        },
      ],
      tags: [],
      stashes: [],
      worktrees: [],
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://example.invalid/repo.git',
          pushUrl: 'https://example.invalid/repo.git',
        },
      ],
    };
    const call = vi.fn(() => Promise.resolve(refs));
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(port.readRefs('/repos/uno')).resolves.toEqual(refs);
    expect(call).toHaveBeenCalledWith('git_read_refs', { id: '/repos/uno' });
  });

  it('lee y recupera una entrada de reflog con la precondición exacta', async () => {
    const entry = {
      selector: 'HEAD@{2}',
      sha: 'b'.repeat(40),
      at: 1_725_000_000_000,
      summary: 'reset: moving to HEAD~2',
    };
    const refs = { head: { branch: 'main', sha: 'a'.repeat(40), detached: false } };
    const call = vi.fn((command: string) =>
      Promise.resolve(command === 'git_read_reflog' ? [entry] : refs),
    );
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(port.readReflog('/repos/uno')).resolves.toEqual([entry]);
    await expect(
      port.recoverReflogEntry('/repos/uno', 'rescate', entry.selector, entry.sha),
    ).resolves.toEqual(refs);
    expect(call.mock.calls).toEqual([
      ['git_read_reflog', { id: '/repos/uno' }],
      [
        'git_recover_reflog_entry',
        {
          id: '/repos/uno',
          name: 'rescate',
          selector: entry.selector,
          expectedSha: entry.sha,
        },
      ],
    ]);
  });

  it('transporta alta, edición y baja de remoto con sus precondiciones exactas', async () => {
    const refs = { remotes: [] } as unknown as RefsSnapshot;
    const call = vi.fn(() => Promise.resolve(refs));
    const port = createTauriGitPort(createMockGitPort(), call);
    const remote = {
      name: 'upstream',
      fetchUrl: 'https://example.invalid/read.git',
      pushUrl: 'ssh://example.invalid/write.git',
    };
    const expected = {
      fetchUrl: 'https://example.invalid/old.git',
      pushUrl: 'https://example.invalid/old.git',
    };

    await port.addRemote('/repos/uno', remote);
    await port.updateRemote('/repos/uno', 'origin', remote, expected);
    await port.removeRemote('/repos/uno', 'upstream', expected);

    expect(call.mock.calls).toEqual([
      ['git_add_remote', { id: '/repos/uno', remote }],
      ['git_update_remote', { id: '/repos/uno', currentName: 'origin', remote, expected }],
      ['git_remove_remote', { id: '/repos/uno', name: 'upstream', expected }],
    ]);
  });

  it('crea una rama local en Rust con origen y opción exactos', async () => {
    const refs = {
      head: { branch: 'nueva', sha: 'a'.repeat(40), detached: false },
    } as RefsSnapshot;
    const call = vi.fn(() => Promise.resolve(refs));
    const port = createTauriGitPort(createMockGitPort(), call);
    const from = { kind: 'tag', name: 'v1' } as const;

    await expect(
      port.createBranch('/repos/uno', 'nueva', from, { checkout: true }),
    ).resolves.toEqual(refs);
    expect(call).toHaveBeenCalledWith('git_create_branch', {
      id: '/repos/uno',
      name: 'nueva',
      from,
      options: { checkout: true },
    });
  });

  it('borra una rama local en Rust con la punta observada', async () => {
    const refs = { head: { branch: 'main', sha: 'a'.repeat(40), detached: false } } as RefsSnapshot;
    const call = vi.fn(() => Promise.resolve(refs));
    const port = createTauriGitPort(createMockGitPort(), call);
    const expectedTip = 'b'.repeat(40);

    await expect(
      port.deleteBranch('/repos/uno', 'dev', { force: true, expectedTip }),
    ).resolves.toEqual(refs);
    expect(call).toHaveBeenCalledWith('git_delete_branch', {
      id: '/repos/uno',
      name: 'dev',
      options: { force: true, expectedTip },
    });
  });

  it('renombra una rama local en Rust con la punta observada', async () => {
    const refs = {
      head: { branch: 'principal', sha: 'a'.repeat(40), detached: false },
    } as RefsSnapshot;
    const call = vi.fn(() => Promise.resolve(refs));
    const port = createTauriGitPort(createMockGitPort(), call);
    const expectedTip = 'b'.repeat(40);

    await expect(
      port.renameBranch('/repos/uno', 'main', 'principal', { expectedTip }),
    ).resolves.toEqual(refs);
    expect(call).toHaveBeenCalledWith('git_rename_branch', {
      id: '/repos/uno',
      from: 'main',
      to: 'principal',
      options: { expectedTip },
    });
  });

  it('crea un tag local en Rust con destino y mensaje exactos', async () => {
    const refs = { head: { branch: 'main', sha: 'a'.repeat(40), detached: false } } as RefsSnapshot;
    const call = vi.fn(() => Promise.resolve(refs));
    const port = createTauriGitPort(createMockGitPort(), call);
    const at = { kind: 'commit', sha: 'b'.repeat(40) } as const;

    await expect(port.createTag('/repos/uno', 'v1', at, { message: 'Lista' })).resolves.toEqual(
      refs,
    );
    expect(call).toHaveBeenCalledWith('git_create_tag', {
      id: '/repos/uno',
      name: 'v1',
      at,
      options: { message: 'Lista' },
    });
  });

  it('borra un tag local en Rust con el destino observado', async () => {
    const refs = { head: { branch: 'main', sha: 'a'.repeat(40), detached: false } } as RefsSnapshot;
    const call = vi.fn(() => Promise.resolve(refs));
    const port = createTauriGitPort(createMockGitPort(), call);
    const expectedTip = 'b'.repeat(40);

    await expect(port.deleteTag('/repos/uno', 'v1', { expectedTip })).resolves.toEqual(refs);
    expect(call).toHaveBeenCalledWith('git_delete_tag', {
      id: '/repos/uno',
      name: 'v1',
      options: { expectedTip },
    });
  });

  it('cambia de referencia en Rust y conserva la opción de guardado automático', async () => {
    const refs = { head: { branch: 'dev', sha: 'a'.repeat(40), detached: false } } as RefsSnapshot;
    const call = vi.fn(() => Promise.resolve(refs));
    const port = createTauriGitPort(createMockGitPort(), call);
    const target = { kind: 'branch', name: 'dev' } as const;

    await expect(port.checkout('/repos/uno', target, { autoStash: true })).resolves.toEqual(refs);
    expect(call).toHaveBeenCalledWith('git_checkout', {
      id: '/repos/uno',
      target,
      options: { autoStash: true },
    });
  });

  it('lee páginas de historia en Rust con todos sus filtros', async () => {
    const page = { commits: [], total: 12, hasMore: true };
    const call = vi.fn((_command: string, _args?: Record<string, unknown>) =>
      Promise.resolve(page),
    );
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(
      port.readCommits('/repos/uno', { start: 'main', since: 42, skip: 3, limit: 4 }),
    ).resolves.toEqual(page);

    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]?.[0]).toBe('git_read_commits');
    const args = call.mock.calls[0]?.[1];
    expect(args).toMatchObject({
      id: '/repos/uno',
      page: { start: 'main', since: 42, skip: 3, limit: 4 },
    });
    expect(typeof args?.operationId).toBe('string');
    expect(String(args?.operationId)).toMatch(/^history-/);
  });

  it('calcula la vista previa en Rust y mantiene inactivas las escrituras de integración', async () => {
    const preview = {
      kind: 'merge' as const,
      source: 'feature',
      target: 'main',
      commits: [],
      fastForward: true,
      conflicts: [],
      precondition: {
        sourceRef: 'feature',
        targetRef: 'main',
        sourceOid: 'a'.repeat(40),
        targetOid: 'b'.repeat(40),
      },
    };
    const call = vi.fn((_command: string, _args?: Record<string, unknown>) =>
      Promise.resolve(preview),
    );
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(
      port.previewIntegration('/repos/uno', 'merge', 'feature', 'main'),
    ).resolves.toEqual(preview);
    expect(port.integrationWritesAvailable).toBe(true);
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0]?.[0]).toBe('git_preview_integration');
    expect(call.mock.calls[0]?.[1]).toMatchObject({
      id: '/repos/uno',
      kind: 'merge',
      source: 'feature',
      target: 'main',
    });
    expect(String(call.mock.calls[0]?.[1]?.operationId)).toMatch(/^preview-/);
  });

  it('cancela también una vista previa nativa en curso', async () => {
    const controller = new AbortController();
    let finishPreview: ((value: unknown) => void) | undefined;
    const call = vi.fn((command: string, _args?: Record<string, unknown>) => {
      if (command === 'git_preview_integration') {
        return new Promise<unknown>((resolve) => {
          finishPreview = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const port = createTauriGitPort(createMockGitPort(), call);
    const reading = port.previewIntegration('/repos/uno', 'merge', 'feature', 'main', {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(call).toHaveBeenCalled());

    controller.abort();
    const previewCall = call.mock.calls.find(([command]) => command === 'git_preview_integration');
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('git_cancel_history', {
        operationId: previewCall?.[1]?.operationId,
      }),
    );
    finishPreview?.({});
    await expect(reading).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('inicia merge y rebase con las puntas exactas de la vista previa', async () => {
    const repository = { id: '/repos/uno', path: '/repos/uno' } as Repository;
    const call = vi.fn(() => Promise.resolve(repository));
    const port = createTauriGitPort(createMockGitPort(), call);
    const precondition = {
      sourceRef: 'feature',
      targetRef: 'main',
      sourceOid: 'a'.repeat(40),
      targetOid: 'b'.repeat(40),
    };

    await expect(
      port.merge('/repos/uno', 'feature', { noFastForward: true, precondition }),
    ).resolves.toBe(repository);
    await expect(port.rebase('/repos/uno', 'feature', { precondition })).resolves.toBe(repository);

    expect(call).toHaveBeenNthCalledWith(1, 'git_merge', {
      id: '/repos/uno',
      source: 'feature',
      options: { noFastForward: true },
      precondition,
    });
    expect(call).toHaveBeenNthCalledWith(2, 'git_rebase', {
      id: '/repos/uno',
      onto: 'feature',
      precondition,
    });
  });

  it('inicia cherry-pick y revert con la punta exacta que confirmó el diálogo', async () => {
    const repository = { id: '/repos/uno', path: '/repos/uno' } as Repository;
    const call = vi.fn(() => Promise.resolve(repository));
    const port = createTauriGitPort(createMockGitPort(), call);
    const shas = ['a'.repeat(40), 'b'.repeat(40)];
    const precondition = { targetRef: 'main', targetOid: 'c'.repeat(40) };

    await expect(port.cherryPick('/repos/uno', shas, { precondition, mainline: 2 })).resolves.toBe(
      repository,
    );
    await expect(port.revert('/repos/uno', shas, { precondition })).resolves.toBe(repository);

    expect(call).toHaveBeenNthCalledWith(1, 'git_cherry_pick', {
      id: '/repos/uno',
      shas,
      precondition,
      mainline: 2,
    });
    expect(call).toHaveBeenNthCalledWith(2, 'git_revert', {
      id: '/repos/uno',
      shas,
      precondition,
      mainline: null,
    });
  });

  it('ejecuta reset con la rama y las tres huellas que mostró el diálogo', async () => {
    const repository = { id: '/repos/uno', path: '/repos/uno' } as Repository;
    const call = vi.fn(() => Promise.resolve(repository));
    const port = createTauriGitPort(createMockGitPort(), call);
    const precondition = {
      head: 'a'.repeat(40),
      indexTree: 'b'.repeat(40),
      worktreeTree: 'c'.repeat(40),
    };

    await expect(
      port.reset('/repos/uno', 'd'.repeat(40), 'hard', {
        expectedBranch: 'main',
        precondition,
      }),
    ).resolves.toBe(repository);

    expect(call).toHaveBeenCalledWith('git_reset', {
      id: '/repos/uno',
      to: 'd'.repeat(40),
      mode: 'hard',
      expectedBranch: 'main',
      precondition,
    });
  });

  it('transporta el stash y el árbol exactos a guardar, aplicar y descartar', async () => {
    const call = vi.fn(() => Promise.resolve({}));
    const port = createTauriGitPort(createMockGitPort(), call);
    const precondition = {
      head: 'a'.repeat(40),
      indexTree: 'b'.repeat(40),
      worktreeTree: 'c'.repeat(40),
    };
    const expectedStash = 'd'.repeat(40);

    await port.createStash('/repos/uno', 'Trabajo', { includeUntracked: true, precondition });
    await port.applyStash('/repos/uno', 2, { drop: true, expectedStash, precondition });
    await port.dropStash('/repos/uno', 2, { expectedStash });
    await port.renameStash('/repos/uno', 2, 'Otro nombre', { expectedStash });

    expect(call).toHaveBeenNthCalledWith(1, 'git_create_stash', {
      id: '/repos/uno',
      message: 'Trabajo',
      options: { includeUntracked: true, precondition },
    });
    expect(call).toHaveBeenNthCalledWith(2, 'git_apply_stash', {
      id: '/repos/uno',
      index: 2,
      options: { drop: true, expectedStash, precondition },
    });
    expect(call).toHaveBeenNthCalledWith(3, 'git_drop_stash', {
      id: '/repos/uno',
      index: 2,
      expectedStash,
    });
    expect(call).toHaveBeenNthCalledWith(4, 'git_rename_stash', {
      id: '/repos/uno',
      index: 2,
      message: 'Otro nombre',
      expectedStash,
    });
  });

  it('cancela también el recorrido nativo de historia', async () => {
    const controller = new AbortController();
    let finishHistory: ((value: unknown) => void) | undefined;
    const call = vi.fn((command: string, _args?: Record<string, unknown>) => {
      if (command === 'git_read_commits') {
        return new Promise<unknown>((resolve) => {
          finishHistory = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const port = createTauriGitPort(createMockGitPort(), call);
    const reading = port.readCommits('/repos/uno', { limit: 500 }, { signal: controller.signal });
    await vi.waitFor(() => expect(call).toHaveBeenCalled());

    controller.abort();
    const historyCall = call.mock.calls.find(([command]) => command === 'git_read_commits');
    const operationId = historyCall?.[1]?.operationId;
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('git_cancel_history', { operationId }),
    );
    finishHistory?.({ commits: [], total: 0, hasMore: false });
    await expect(reading).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('lee el detalle de commit real y descarta una respuesta cancelada', async () => {
    const details = {
      commit: {
        sha: 'a'.repeat(40),
        parents: [],
        summary: 'Inicial',
        body: '',
        author: { name: 'Autora', email: 'autora@example.com' },
        authoredAt: 42,
        committer: { name: 'Comitter', email: 'committer@example.com' },
        committedAt: 42,
      },
      files: [],
      refs: ['main'],
    } satisfies CommitDetails;
    const controller = new AbortController();
    const call = vi.fn(() => {
      controller.abort();
      return Promise.resolve(details);
    });
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(port.readCommit('/repos/uno', details.commit.sha)).resolves.toEqual(details);
    await expect(
      port.readCommit('/repos/uno', details.commit.sha, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
    expect(call).toHaveBeenCalledWith('git_read_commit', {
      id: '/repos/uno',
      sha: details.commit.sha,
    });
  });

  it('passes encoding overrides to all native byte reads and conflict saves', async () => {
    const call = vi.fn().mockResolvedValue({});
    const port = createTauriGitPort(createMockGitPort(), call);
    await port.readDiff('/repo', {
      path: 'file.txt',
      source: { kind: 'index' },
      encoding: 'shift_jis',
    });
    await port.readFile('/repo', 'file.txt', undefined, { encoding: 'utf-16le' });
    await port.readConflict('/repo', 'file.txt', { encoding: 'windows-1252' });
    await port.resolveConflict('/repo', 'file.txt', 'café', {
      encoding: 'windows-1252',
      expectedRevision: 'stages',
    });
    expect(call).toHaveBeenCalledWith(
      'git_read_diff',
      expect.objectContaining({
        request: { path: 'file.txt', source: { kind: 'index' }, encoding: 'shift_jis' },
      }),
    );
    expect(call).toHaveBeenCalledWith('git_read_file', {
      id: '/repo',
      path: 'file.txt',
      at: null,
      encoding: 'utf-16le',
    });
    expect(call).toHaveBeenCalledWith('git_read_conflict', {
      id: '/repo',
      path: 'file.txt',
      encoding: 'windows-1252',
    });
    expect(call).toHaveBeenCalledWith('git_resolve_conflict', {
      id: '/repo',
      path: 'file.txt',
      content: 'café',
      encoding: 'windows-1252',
      expectedRevision: 'stages',
    });
  });

  it('reads an exact index blob instead of the worktree file', async () => {
    const call = vi.fn().mockResolvedValue({});
    const port = createTauriGitPort(createMockGitPort(), call);
    const blob = 'a'.repeat(40);
    await port.readFile('/repo', 'mixed.txt', undefined, { blob, encoding: 'utf-8' });
    expect(call).toHaveBeenCalledWith('git_read_file', {
      id: '/repo',
      path: 'mixed.txt',
      at: null,
      blob,
      encoding: 'utf-8',
    });
  });

  it('lee contenido, árbol e historial de archivo en Rust', async () => {
    const call = vi.fn((command: string) => {
      if (command === 'git_read_file') {
        return Promise.resolve({
          path: 'src/app.ts',
          text: 'export {};\n',
          binary: false,
          size: 11,
          mediaType: 'text/plain',
          encoding: 'utf-8',
        });
      }
      if (command === 'git_read_tree') {
        return Promise.resolve([{ path: 'src', kind: 'directory' }]);
      }
      return Promise.resolve([]);
    });
    const port = createTauriGitPort(createMockGitPort(), call);

    await port.readFile('/repos/uno', 'src/app.ts', 'a'.repeat(40));
    await port.readTree('/repos/uno');
    await port.readFileHistory('/repos/uno', 'src/app.ts');

    expect(call.mock.calls).toEqual([
      ['git_read_file', { id: '/repos/uno', path: 'src/app.ts', at: 'a'.repeat(40) }],
      ['git_read_tree', { id: '/repos/uno', at: null }],
      ['git_read_file_history', { id: '/repos/uno', path: 'src/app.ts' }],
    ]);
  });

  it('lee en Rust diffs de trabajo, índice, commit y rango', async () => {
    const nativeDiff: FileDiff = {
      path: 'archivo.txt',
      change: 'modified',
      source: { kind: 'worktree' },
      precondition: {
        before: { oid: 'a'.repeat(40), mode: '100644' },
        after: { oid: 'b'.repeat(40), mode: '100644' },
      },
      content: { kind: 'text', hunks: [], truncated: false, encoding: 'utf-8' },
    };
    const call = vi.fn((_command: string, _args?: Record<string, unknown>) =>
      Promise.resolve(nativeDiff),
    );
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(
      port.readDiff('/repos/uno', {
        path: 'archivo.txt',
        source: { kind: 'worktree' },
        context: 5,
        ignoreWhitespace: true,
      }),
    ).resolves.toEqual(nativeDiff);
    await port.readDiff('/repos/uno', {
      path: 'archivo.txt',
      source: { kind: 'index' },
    });
    await port.readDiff('/repos/uno', {
      path: 'archivo.txt',
      source: { kind: 'commit', sha: 'abc1234' },
    });
    await port.readDiff('/repos/uno', {
      path: 'archivo.txt',
      source: { kind: 'range', from: 'abc1234', to: 'def5678' },
    });
    await port.readDiff('/repos/uno', {
      path: 'archivo.txt',
      source: { kind: 'workingRange', from: 'abc1234' },
    });
    const operationIds = call.mock.calls.map(([, args]) => args?.operationId);
    for (const operationId of operationIds) {
      expect(operationId).toEqual(expect.stringMatching(/^diff-/));
    }

    expect(call).toHaveBeenNthCalledWith(1, 'git_read_diff', {
      id: '/repos/uno',
      operationId: operationIds[0],
      request: {
        path: 'archivo.txt',
        source: { kind: 'worktree' },
        context: 5,
        ignoreWhitespace: true,
      },
    });
    expect(call).toHaveBeenNthCalledWith(2, 'git_read_diff', {
      id: '/repos/uno',
      operationId: operationIds[1],
      request: { path: 'archivo.txt', source: { kind: 'index' } },
    });
    expect(call).toHaveBeenNthCalledWith(3, 'git_read_diff', {
      id: '/repos/uno',
      operationId: operationIds[2],
      request: { path: 'archivo.txt', source: { kind: 'commit', sha: 'abc1234' } },
    });
    expect(call).toHaveBeenNthCalledWith(4, 'git_read_diff', {
      id: '/repos/uno',
      operationId: operationIds[3],
      request: {
        path: 'archivo.txt',
        source: { kind: 'range', from: 'abc1234', to: 'def5678' },
      },
    });
    expect(call).toHaveBeenNthCalledWith(5, 'git_read_diff', {
      id: '/repos/uno',
      operationId: operationIds[4],
      request: {
        path: 'archivo.txt',
        source: { kind: 'workingRange', from: 'abc1234' },
      },
    });
  });

  it('lists the native net changes for exact endpoints, WIP and a root range', async () => {
    const files = [
      { path: 'changed.txt', change: 'modified', binary: false, insertions: 2, deletions: 1 },
    ];
    const call = vi.fn().mockResolvedValue(files);
    const port = createTauriGitPort(createMockGitPort(), call);
    for (const source of [
      { kind: 'range', from: 'abc1234', to: 'def5678' },
      { kind: 'workingRange', from: 'abc1234' },
      { kind: 'range', from: null, to: 'def5678' },
    ] as const) {
      await expect(port.readDiffFiles('/repos/uno', source)).resolves.toEqual(files);
      expect(call).toHaveBeenLastCalledWith('git_read_diff_files', {
        id: '/repos/uno',
        source,
        operationId: expect.stringMatching(/^diff-/) as unknown,
      });
    }
  });

  it('cancels the native file comparison when its selection goes away', async () => {
    const controller = new AbortController();
    let finish: ((value: unknown) => void) | undefined;
    const call = vi.fn((command: string, _args?: Record<string, unknown>) => {
      if (command === 'git_read_diff_files') {
        return new Promise<unknown>((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const port = createTauriGitPort(createMockGitPort(), call);
    const reading = port.readDiffFiles(
      '/repos/uno',
      { kind: 'range', from: 'abc1234', to: 'def5678' },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    controller.abort();
    const operationId = call.mock.calls.find(([command]) => command === 'git_read_diff_files')?.[1]
      ?.operationId;
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('git_cancel_diff', { operationId }));
    finish?.([]);
    await expect(reading).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('cancela en Rust un diff que ya no se necesita', async () => {
    const controller = new AbortController();
    let finishDiff: ((value: unknown) => void) | undefined;
    const call = vi.fn((command: string, _args?: Record<string, unknown>) => {
      if (command === 'git_read_diff') {
        return new Promise<unknown>((resolve) => {
          finishDiff = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const port = createTauriGitPort(createMockGitPort(), call);
    const reading = port.readDiff(
      '/repos/uno',
      { path: 'archivo.txt', source: { kind: 'commit', sha: 'abc1234' } },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalled());

    controller.abort();
    const diffCall = call.mock.calls.find(([command]) => command === 'git_read_diff');
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('git_cancel_diff', {
        operationId: diffCall?.[1]?.operationId,
      }),
    );
    finishDiff?.({});
    await expect(reading).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('envía las escrituras locales y de Resolver a comandos nativos separados', async () => {
    const status: WorkingStatus = { staged: [], unstaged: [], conflicted: [], clean: true };
    const precondition = {
      before: { oid: 'a'.repeat(40), mode: '100644' as const },
      after: { oid: 'b'.repeat(40), mode: '100644' as const },
    };
    const partial = { path: 'archivo.txt', hunkIds: ['hunk-1'], precondition };
    const lines = {
      path: 'archivo.txt',
      lines: [{ side: 'new' as const, line: 2 }],
      precondition,
    };
    const targets = [{ path: 'archivo.txt', precondition }];
    const call = vi.fn(() => Promise.resolve(status));
    const port = createTauriGitPort(createMockGitPort(), call);

    await port.stage('/repos/uno', ['archivo.txt']);
    await port.unstage('/repos/uno', ['archivo.txt']);
    await port.stageHunks('/repos/uno', partial);
    await port.unstageHunks('/repos/uno', partial);
    await port.stageLines('/repos/uno', lines);
    await port.unstageLines('/repos/uno', lines);
    await port.discard('/repos/uno', targets);
    await port.discardLines('/repos/uno', lines);
    await port.resolveConflict('/repos/uno', 'archivo.txt', 'resuelto\n');
    await port.markConflictResolved('/repos/uno', 'archivo.txt');
    await port.markConflictsResolved('/repos/uno', ['archivo.txt', 'otro.txt']);
    await port.unresolveConflict('/repos/uno', 'archivo.txt');
    await port.keepSide('/repos/uno', 'archivo.txt', 'theirs');
    await port.autoResolve('/repos/uno');
    await port.continueOperation('/repos/uno');
    await port.abortOperation('/repos/uno');
    await port.quitOperation('/repos/uno');

    expect(call.mock.calls).toEqual([
      ['git_stage', { id: '/repos/uno', paths: ['archivo.txt'] }],
      ['git_unstage', { id: '/repos/uno', paths: ['archivo.txt'] }],
      ['git_stage_hunks', { id: '/repos/uno', request: partial }],
      ['git_unstage_hunks', { id: '/repos/uno', request: partial }],
      ['git_stage_lines', { id: '/repos/uno', request: lines }],
      ['git_unstage_lines', { id: '/repos/uno', request: lines }],
      ['git_discard', { id: '/repos/uno', targets }],
      ['git_discard_lines', { id: '/repos/uno', request: lines }],
      ['git_resolve_conflict', { id: '/repos/uno', path: 'archivo.txt', content: 'resuelto\n' }],
      ['git_mark_conflict_resolved', { id: '/repos/uno', path: 'archivo.txt' }],
      ['git_mark_conflicts_resolved', { id: '/repos/uno', paths: ['archivo.txt', 'otro.txt'] }],
      ['git_unresolve_conflict', { id: '/repos/uno', path: 'archivo.txt' }],
      ['git_keep_side', { id: '/repos/uno', path: 'archivo.txt', side: 'theirs' }],
      ['git_auto_resolve', { id: '/repos/uno' }],
      ['git_continue_operation', { id: '/repos/uno' }],
      ['git_abort_operation', { id: '/repos/uno' }],
      ['git_quit_operation', { id: '/repos/uno' }],
    ]);
  });

  it('publica el estado de una escritura aunque la señal se aborte durante Git', async () => {
    const controller = new AbortController();
    const status: WorkingStatus = { staged: [], unstaged: [], conflicted: [], clean: true };
    const port = createTauriGitPort(createMockGitPort(), () => {
      controller.abort();
      return Promise.resolve(status);
    });

    await expect(
      port.stage('/repos/uno', ['archivo.txt'], { signal: controller.signal }),
    ).resolves.toEqual(status);
  });

  it('envía commit y su precondición al comando nativo', async () => {
    const request = {
      summary: 'P2.4: commit real',
      body: 'Conserva el mensaje.',
      precondition: { head: 'a'.repeat(40), indexTree: 'b'.repeat(40) },
    };
    const call = vi.fn(() => Promise.resolve('c'.repeat(40)));
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(port.commit('/repos/uno', request)).resolves.toBe('c'.repeat(40));
    expect(call).toHaveBeenCalledWith('git_commit', { id: '/repos/uno', request });
  });

  it('abre un watcher con canal y lo cierra al desuscribir', async () => {
    const listener = vi.fn();
    let channelHandler: ((change: { worktree: boolean; git: boolean }) => void) | undefined;
    const call = vi.fn((_command: string, _args?: Record<string, unknown>) =>
      Promise.resolve(undefined),
    );
    const port = createTauriGitPort(
      createMockGitPort(),
      call,
      () => Promise.resolve('clone-channel'),
      (handler) => {
        channelHandler = handler;
        return Promise.resolve('watch-channel');
      },
    );

    const stop = await port.watchRepository('/repos/uno', listener);
    channelHandler?.({ worktree: true, git: false });
    expect(listener).toHaveBeenCalledWith({ worktree: true, git: false });
    const start = call.mock.calls[0];
    expect(start?.[0]).toBe('git_watch_repository');
    expect(start?.[1]).toMatchObject({ id: '/repos/uno', onChange: 'watch-channel' });

    stop();
    await vi.waitFor(() => {
      expect(call).toHaveBeenCalledWith('git_unwatch_repository', {
        operationId: start?.[1]?.operationId,
      });
    });
  });

  it('lee y ejecuta la pila nativa de deshacer', async () => {
    const repository = {
      id: '/repos/uno',
      name: 'uno',
      path: '/repos/uno',
      head: 'main',
      lastOpenedAt: null,
      remotes: [],
      operation: { kind: 'none' as const },
      bare: false,
      hasSubmodules: false,
    };
    const stack = { undo: [], redo: [] };
    const call = vi.fn((command: string) =>
      Promise.resolve(command === 'git_read_undo_stack' ? stack : repository),
    );
    const port = createTauriGitPort(createMockGitPort(), call);

    await expect(port.readUndoStack('/repos/uno')).resolves.toEqual(stack);
    await expect(port.undo('/repos/uno')).resolves.toEqual(repository);
    await expect(port.redo('/repos/uno')).resolves.toEqual(repository);
    expect(call.mock.calls).toEqual([
      ['git_read_undo_stack', { id: '/repos/uno' }],
      ['git_undo', { id: '/repos/uno' }],
      ['git_redo', { id: '/repos/uno' }],
    ]);
  });

  it('envía fetch, progreso y cancelación al proceso nativo exacto', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    let channelHandler: ((value: Parameters<typeof progress>[0]) => void) | undefined;
    let finishFetch: ((value: unknown) => void) | undefined;
    const call = vi.fn((command: string, _args?: Record<string, unknown>) => {
      if (command === 'git_fetch') {
        return new Promise<unknown>((resolve) => {
          finishFetch = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const port = createTauriGitPort(createMockGitPort(), call, (handler) => {
      channelHandler = handler;
      return Promise.resolve('canal-red');
    });

    const fetching = port.fetch(
      '/repos/uno',
      'origen',
      { prune: true, onProgress: progress },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    channelHandler?.({ phase: 'receiving', received: 4, total: 10 });
    expect(progress).toHaveBeenCalledWith({ phase: 'receiving', received: 4, total: 10 });
    const fetchCall = call.mock.calls.find(([command]) => command === 'git_fetch');
    expect(fetchCall?.[1]).toMatchObject({
      id: '/repos/uno',
      remote: 'origen',
      options: { prune: true },
      onProgress: 'canal-red',
    });
    expect(String(fetchCall?.[1]?.operationId)).toMatch(/^network-/);

    controller.abort();
    const operationId = fetchCall?.[1]?.operationId;
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('git_cancel_network', { operationId }),
    );
    finishFetch?.({});
    await expect(fetching).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('envía pull, estrategia, progreso y cancelación al mismo registro nativo', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    let channelHandler: ((value: Parameters<typeof progress>[0]) => void) | undefined;
    let finishPull: ((value: unknown) => void) | undefined;
    const call = vi.fn((command: string, _args?: Record<string, unknown>) => {
      if (command === 'git_pull') {
        return new Promise<unknown>((resolve) => {
          finishPull = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const port = createTauriGitPort(createMockGitPort(), call, (handler) => {
      channelHandler = handler;
      return Promise.resolve('canal-pull');
    });

    const pulling = port.pull(
      '/repos/uno',
      { strategy: 'merge', onProgress: progress },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    channelHandler?.({ phase: 'receiving', received: 7, total: 12 });
    expect(progress).toHaveBeenCalledWith({ phase: 'receiving', received: 7, total: 12 });
    const pullCall = call.mock.calls.find(([command]) => command === 'git_pull');
    expect(pullCall?.[1]).toMatchObject({
      id: '/repos/uno',
      options: { strategy: 'merge' },
      onProgress: 'canal-pull',
    });
    expect(String(pullCall?.[1]?.operationId)).toMatch(/^network-/);

    controller.abort();
    const operationId = pullCall?.[1]?.operationId;
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('git_cancel_network', { operationId }),
    );
    finishPull?.({ strategy: 'merge', reason: 'unpublished', received: 1 });
    await expect(pulling).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('envía push con lease observado, progreso y cancelación al proceso nativo', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    let channelHandler: ((value: Parameters<typeof progress>[0]) => void) | undefined;
    let finishPush: ((value: unknown) => void) | undefined;
    const call = vi.fn((command: string, _args?: Record<string, unknown>) => {
      if (command === 'git_push') {
        return new Promise<unknown>((resolve) => {
          finishPush = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const port = createTauriGitPort(createMockGitPort(), call, (handler) => {
      channelHandler = handler;
      return Promise.resolve('canal-push');
    });
    const expectedRemoteTip = 'a'.repeat(40);

    const pushing = port.push(
      '/repos/uno',
      'main',
      { expectedRemoteTip, onProgress: progress },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    channelHandler?.({ phase: 'compressing', received: 3, total: 8 });
    expect(progress).toHaveBeenCalledWith({ phase: 'compressing', received: 3, total: 8 });
    const pushCall = call.mock.calls.find(([command]) => command === 'git_push');
    expect(pushCall?.[1]).toMatchObject({
      id: '/repos/uno',
      branch: 'main',
      options: { expectedRemoteTip },
      onProgress: 'canal-push',
    });
    expect(String(pushCall?.[1]?.operationId)).toMatch(/^network-/);

    controller.abort();
    const operationId = pushCall?.[1]?.operationId;
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('git_cancel_network', { operationId }),
    );
    finishPush?.({});
    await expect(pushing).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('envía progreso y mata la clonación nativa al abortar', async () => {
    const controller = new AbortController();
    const progress = vi.fn();
    let channelHandler: ((value: Parameters<typeof progress>[0]) => void) | undefined;
    let finishClone: ((value: unknown) => void) | undefined;
    const call = vi.fn((command: string, _args?: Record<string, unknown>) => {
      if (command === 'git_clone_repository') {
        return new Promise<unknown>((resolve) => {
          finishClone = resolve;
        });
      }
      return Promise.resolve(undefined);
    });
    const port = createTauriGitPort(createMockGitPort(), call, (handler) => {
      channelHandler = handler;
      return Promise.resolve('canal');
    });

    const cloning = port.cloneRepository(
      { url: '/remotos/uno.git', path: '/repos', name: 'uno', onProgress: progress },
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    channelHandler?.({ phase: 'receiving', received: 4, total: 10 });
    expect(progress).toHaveBeenCalledWith({ phase: 'receiving', received: 4, total: 10 });

    controller.abort();
    const cloneCall = call.mock.calls.find(([command]) => command === 'git_clone_repository');
    const operationId = cloneCall?.[1]?.operationId;
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('git_cancel_clone', { operationId }));
    finishClone?.({});
    await expect(cloning).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it('clasifica rechazos desconocidos sin confiar en su forma', () => {
    expect(decodeTauriGitError({ code: 'inventado', params: {} })).toMatchObject({
      code: 'unknown',
    });
  });
});
