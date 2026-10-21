import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { selectPorts } from '@core/adapters/selectPorts';
import type { Commit, CommitPage } from '@core/domain/commit';
import type { FileChange, WorkingStatus } from '@core/domain/status';
import { I18nProvider } from '@i18n/I18nProvider';
import { esMX } from '@i18n/messages/es-MX';
import { interpolate } from '@i18n/format';

import { useVirtualViewport } from '../../test/virtualViewport';
import { ComparePanel } from './ComparePanel';
import type { MenuBuildContext } from './contextMenus';
import { useWorkingStore, type WorkingCompare } from './workingStore';

const BASE = commit('base', []);
const FEATURE = commit('feature-tip', [BASE.sha]);
const DEV = commit('dev-tip', [BASE.sha]);
const CHANGE: FileChange = {
  path: 'src/app.ts',
  change: 'modified',
  binary: false,
  insertions: 1,
  deletions: 1,
};
const STATUS: WorkingStatus = {
  clean: true,
  staged: [],
  unstaged: [],
  conflicted: [],
};
const COMPARE: WorkingCompare = {
  kind: 'refs',
  source: { ref: 'refs/heads/dev', label: 'dev' },
  target: { ref: 'refs/heads/feature', label: 'feature' },
};

function commit(sha: string, parents: readonly string[]): Commit {
  const person = { name: 'Fixture', email: 'fixture@example.invalid' };
  return {
    sha,
    parents,
    summary: sha,
    body: '',
    author: person,
    committer: person,
    authoredAt: 0,
    committedAt: 0,
  };
}

function page(commits: readonly Commit[], hasMore = false): CommitPage {
  return { commits, hasMore, total: commits.length };
}

function harness() {
  const git = createMockGitPort({ latency: NO_LATENCY });
  const ports = { ...selectPorts(), git };
  const openDiff = vi.fn();
  const context: MenuBuildContext = {
    t: (key, params) => interpolate(esMX[key], params),
    headBranch: 'dev',
    defaultRemote: 'origin',
    branches: [],
    actions: {
      checkout: vi.fn(),
      activateRemoteBranch: vi.fn(),
      createBranch: vi.fn(),
      renameBranch: vi.fn(),
      deleteBranch: vi.fn(),
      createTag: vi.fn(),
      deleteTag: vi.fn(),
      createWorktree: vi.fn(),
      openWorktree: vi.fn(),
      lockWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      fetchRemote: vi.fn(),
      addRemote: vi.fn(),
      editRemote: vi.fn(),
      manageRemoteCredentials: vi.fn(),
      removeRemote: vi.fn(),
      cherryPick: vi.fn(),
      revert: vi.fn(),
      reset: vi.fn(),
      stage: vi.fn(),
      unstage: vi.fn(),
      discard: vi.fn(),
      previewIntegration: vi.fn(),
      compare: vi.fn(),
      ignorePath: vi.fn(),
      viewFileHistory: vi.fn(),
      openDiff,
      stashPaths: vi.fn(),
      applyStashPaths: vi.fn(),
      pop: vi.fn(),
      dropStash: vi.fn(),
      reveal: vi.fn(),
      copy: vi.fn(),
      goToNode: vi.fn(),
      setNodeForm: vi.fn(),
      setAllSectionsCollapsed: vi.fn(),
    },
  };
  const history = vi
    .spyOn(git, 'readCommits')
    .mockImplementation((_id, request) =>
      Promise.resolve(page(request?.start === 'refs/heads/dev' ? [DEV, BASE] : [FEATURE, BASE])),
    );
  const files = vi.spyOn(git, 'readDiffFiles').mockResolvedValue([]);
  const details = vi.spyOn(git, 'readCommit');
  const component = (compare = COMPARE, status = STATUS) => (
    <PortsContext value={ports}>
      <I18nProvider initialLocale="es-MX">
        <ComparePanel
          repoId="gitthul"
          compare={compare}
          status={status}
          menuContext={context}
          onClose={vi.fn()}
        />
      </I18nProvider>
    </PortsContext>
  );
  return { component, files, details, history, openDiff };
}

beforeEach(() => useWorkingStore.getState().reset());

describe('ComparePanel', () => {
  useVirtualViewport(600);

  it('muestra contenido idéntico aunque las dos ramas tengan commits distintos', async () => {
    const { component, files, details } = harness();
    render(component());

    expect(await screen.findByText('Sin diferencias')).toBeVisible();
    expect(screen.getByText('dev tiene 1 commits que feature no')).toBeVisible();
    expect(screen.getByText('feature tiene 1 commits que dev no')).toBeVisible();
    expect(files).toHaveBeenCalledWith(
      'gitthul',
      { kind: 'range', from: DEV.sha, to: FEATURE.sha },
      expect.anything(),
    );
    expect(files.mock.calls[0]?.[2]?.signal).toBeInstanceOf(AbortSignal);
    expect(details).not.toHaveBeenCalled();
  });

  it('abre el diff neto con los mismos SHA usados para listar los archivos', async () => {
    const { component, files, openDiff } = harness();
    files.mockResolvedValue([{ ...CHANGE, change: 'deleted', insertions: 0 }]);
    render(component());

    fireEvent.mouseDown(await screen.findByText('app.ts'), { button: 0 });
    expect(openDiff).toHaveBeenCalledWith(CHANGE.path, {
      kind: 'range',
      from: DEV.sha,
      to: FEATURE.sha,
    });
  });

  it('recarga al cambiar el historial y conserva las revisiones de cada lectura', async () => {
    const { component, files, history, openDiff } = harness();
    files.mockResolvedValue([CHANGE]);
    render(component());
    await screen.findByText('app.ts');
    const moved = commit('dev-moved', [DEV.sha]);
    history.mockImplementation((_id, request) =>
      Promise.resolve(
        page(request?.start === 'refs/heads/dev' ? [moved, DEV, BASE] : [FEATURE, BASE]),
      ),
    );
    act(() => useWorkingStore.getState().bumpHistory());
    await waitFor(() =>
      expect(files).toHaveBeenLastCalledWith(
        'gitthul',
        { kind: 'range', from: moved.sha, to: FEATURE.sha },
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(screen.getByText('dev tiene 2 commits que feature no')).toBeVisible(),
    );
    fireEvent.mouseDown(screen.getByText('app.ts'), { button: 0 });
    expect(openDiff).toHaveBeenLastCalledWith(CHANGE.path, {
      kind: 'range',
      from: moved.sha,
      to: FEATURE.sha,
    });
  });

  it('compara WIP directamente y recarga si cambia su estado', async () => {
    const { component, files } = harness();
    const compare: WorkingCompare = {
      ...COMPARE,
      kind: 'refs',
      target: { kind: 'wip', label: 'WIP' },
    };
    const { rerender } = render(component(compare));
    await screen.findByText('Sin diferencias');
    files.mockResolvedValue([CHANGE]);
    rerender(component(compare, { ...STATUS, clean: false, unstaged: [CHANGE] }));
    await screen.findByText('app.ts');
    expect(files).toHaveBeenLastCalledWith(
      'gitthul',
      { kind: 'workingRange', from: DEV.sha },
      expect.anything(),
    );
  });

  it.each([false, true])(
    'el diff combinado usa el padre inicial o el árbol vacío (raíz: %s)',
    async (root) => {
      const { component, details, files } = harness();
      const oldest = commit('oldest', root ? [] : [BASE.sha]);
      details.mockResolvedValue({ commit: oldest, files: [CHANGE], refs: [] });
      render(component({ kind: 'combined', shas: [oldest.sha, 'middle', 'newest'] }));

      expect(await screen.findByText('Sin diferencias')).toBeVisible();
      expect(files).toHaveBeenCalledWith(
        'gitthul',
        { kind: 'range', from: root ? null : BASE.sha, to: 'newest' },
        expect.anything(),
      );
      expect(details).toHaveBeenCalledTimes(1);
    },
  );

  it('no limita los archivos a los cambios de los primeros 200 commits', async () => {
    const { component, files, history, details } = harness();
    history.mockResolvedValue(
      page(Array.from({ length: 201 }, (_, index) => commit(String(index), []))),
    );
    files.mockResolvedValue([CHANGE]);
    render(component());
    expect(await screen.findByText('app.ts')).toBeVisible();
    expect(details).not.toHaveBeenCalled();
    expect(screen.queryByText(/La lista de archivos solo/)).not.toBeInTheDocument();
  });

  it('una respuesta tardía de otra selección no reemplaza el resultado actual', async () => {
    const { component, files } = harness();
    let finish: (changes: readonly FileChange[]) => void = () => {};
    files.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const { rerender } = render(component());
    await waitFor(() => expect(files).toHaveBeenCalledTimes(1));
    const signal = files.mock.calls[0]?.[2]?.signal;
    rerender(
      component({ kind: 'refs', source: COMPARE.source, target: { ref: 'other', label: 'other' } }),
    );
    await screen.findByText('Sin diferencias');
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish([CHANGE]);
      await Promise.resolve();
    });
    expect(screen.getByText('Sin diferencias')).toBeVisible();
    expect(screen.queryByText('app.ts')).not.toBeInTheDocument();
  });

  it('advierte sobre el recuento parcial sin limitar la lista de archivos', async () => {
    const { component, history, files } = harness();
    history.mockResolvedValue(page([DEV, BASE], true));
    files.mockResolvedValue([CHANGE]);
    render(component());

    expect(await screen.findByText('app.ts')).toBeVisible();
    expect(
      screen.getByText(
        'El recuento de commits se limita a los primeros 5000 de cada lado; la lista de archivos está completa',
      ),
    ).toBeVisible();
  });
});
