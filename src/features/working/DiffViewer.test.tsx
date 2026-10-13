import { SelectionRange } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortsContext } from '@app/PortsContext';
import { createMockGitPort } from '@core/adapters/mock/mockGitPort';
import { NO_LATENCY } from '@core/adapters/mock/latency';
import { selectPorts } from '@core/adapters/selectPorts';
import { I18nProvider } from '@i18n/I18nProvider';

import { DiffViewer } from './DiffViewer';
import styles from './DiffViewer.module.css';
import type { WorkingActions } from './useWorkingActions';
import { useWorkingStore } from './workingStore';

beforeEach(() => useWorkingStore.getState().reset());

describe('WIP con muchos hunks', () => {
  it.each([
    ['unified', 'worktree'],
    ['split', 'worktree'],
    ['unified', 'index'],
    ['split', 'index'],
  ] as const)(
    'conserva los mismos editores durante scroll y los botones de stage (%s, %s)',
    async (columns, kind) => {
      const git = createMockGitPort({ latency: NO_LATENCY });
      const path = 'src/design/roles.css';
      const source = { kind };
      const direction = kind === 'worktree' ? 'stage' : 'unstage';
      const file = await git.readDiff('gitthul', {
        path,
        source: { kind: 'worktree' },
        ignoreWhitespace: false,
      });
      if (file.content.kind !== 'text') throw new Error('El fixture debe ser textual');
      const first = file.content.hunks[0]!;
      const hunks = Array.from({ length: 200 }, (_, index) => ({
        ...first,
        id: `large-${String(index)}`,
        lines: [
          {
            kind: 'context' as const,
            text: 'before',
            oldLine: 10 + index * 100,
            newLine: 10 + index * 100,
          },
          { kind: 'removed' as const, text: 'old', oldLine: 11 + index * 100, newLine: null },
          { kind: 'added' as const, text: 'new', oldLine: null, newLine: 11 + index * 100 },
        ],
      }));
      vi.spyOn(git, 'readDiff').mockResolvedValue({
        ...file,
        content: { ...file.content, hunks },
      });
      useWorkingStore.getState().setDiffOptions({ columns, scope: 'hunks', content: 'diff' });
      const stageHunk = vi.fn();
      const stageLines = vi.fn();
      const actions = { stageHunk, stageLines } as unknown as WorkingActions;
      const { container } = render(
        <PortsContext value={{ ...selectPorts(), git }}>
          <I18nProvider initialLocale="es-MX">
            <DiffViewer
              repoId="gitthul"
              diff={{ path, source, returnTo: null }}
              actions={actions}
              status={null}
              onClose={() => {}}
            />
          </I18nProvider>
        </PortsContext>,
      );
      const editors = await screen.findAllByRole('textbox');
      expect(editors).toHaveLength(columns === 'split' ? 2 : 1);
      const views = editors.map((editor) => EditorView.findFromDOM(editor));
      const destroy = vi.spyOn(EditorView.prototype, 'destroy');
      const scroll = container.querySelector(`.${styles.diffScroll}`)!;
      for (const scrollTop of [800, 8000, 20000, 0]) {
        fireEvent.scroll(scroll, { target: { scrollTop } });
        expect(screen.getAllByRole('textbox')).toEqual(editors);
        expect(editors.map((editor) => EditorView.findFromDOM(editor))).toEqual(views);
      }
      expect(destroy).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getAllByRole('button', {
          name:
            kind === 'worktree' ? 'Agregar el hunk 1 al staging' : 'Quitar el hunk 1 del staging',
        })[0]!,
      );
      expect(stageHunk).toHaveBeenCalledWith(path, 'large-0', direction, file.precondition, false);
      const view = views.at(-1)!;
      const line = view.state.doc.line(columns === 'split' ? 3 : 4);
      act(() => view.dispatch({ selection: { anchor: line.from, head: line.to } }));
      fireEvent.click(
        screen.getAllByRole('button', {
          name: kind === 'worktree' ? 'Agregar 1 líneas al staging' : 'Quitar 1 líneas del staging',
        })[0]!,
      );
      expect(stageLines).toHaveBeenCalledWith(
        path,
        columns === 'split'
          ? [
              { side: 'old', line: 11 },
              { side: 'new', line: 11 },
            ]
          : [{ side: 'new', line: 11 }],
        direction,
        file.precondition,
        false,
      );
      destroy.mockRestore();
    },
  );
});

it.each([false, true])(
  'conserva el editor durante un refresco de status (contenido cambiado: %s)',
  async (changed) => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const path = 'src/design/roles.css';
    const diff = { path, source: { kind: 'worktree' as const }, returnTo: null };
    const status = await git.readStatus('gitthul');
    const file = await git.readDiff('gitthul', { path, source: diff.source });
    let resolveRefresh!: (value: typeof file) => void;
    const refresh = new Promise<typeof file>((resolve) => {
      resolveRefresh = resolve;
    });
    const read = vi.spyOn(git, 'readDiff').mockResolvedValueOnce(file).mockReturnValueOnce(refresh);
    const ports = { ...selectPorts(), git };
    const actions = { stageHunk: vi.fn(), stageLines: vi.fn() } as unknown as WorkingActions;
    useWorkingStore
      .getState()
      .setDiffOptions({ columns: 'unified', scope: 'hunks', content: 'diff' });
    const view = (snapshot: typeof status) => (
      <PortsContext value={ports}>
        <I18nProvider initialLocale="es-MX">
          <DiffViewer
            repoId="gitthul"
            diff={diff}
            actions={actions}
            status={snapshot}
            onClose={() => {}}
          />
        </I18nProvider>
      </PortsContext>
    );
    const { rerender } = render(view(status));
    const editors = await screen.findAllByRole('textbox');
    const editorView = EditorView.findFromDOM(editors[0]!)!;
    const added = editorView.state.doc
      .toString()
      .split('\n')
      .findIndex((line) => line.startsWith('+'));
    expect(added).toBeGreaterThanOrEqual(0);
    const selectedLine = editorView.state.doc.line(added + 1);
    act(() =>
      editorView.dispatch({ selection: { anchor: selectedLine.from, head: selectedLine.to } }),
    );
    const selectedAction = screen.getByRole('button', { name: 'Agregar 1 líneas al staging' });
    const states = editors.map((editor) => EditorView.findFromDOM(editor)!.state);
    rerender(view({ ...status }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(editors.every((editor) => editor.isConnected)).toBe(true);
    const fresh = structuredClone(file);
    if (changed && fresh.content.kind === 'text') {
      fresh.content = {
        ...fresh.content,
        hunks: fresh.content.hunks.map((hunk, index) =>
          index === 0
            ? {
                ...hunk,
                lines: hunk.lines.map((line) => ({ ...line, text: 'contenido actualizado' })),
              }
            : hunk,
        ),
      };
    }
    await act(async () => {
      resolveRefresh(fresh);
      await refresh;
    });
    expect(screen.getAllByRole('textbox')).toEqual(editors);
    if (changed) {
      expect(
        screen.queryByRole('button', { name: 'Agregar 1 líneas al staging' }),
      ).not.toBeInTheDocument();
      expect(EditorView.findFromDOM(editors[0]!)!.state.doc.toString()).toContain(
        'contenido actualizado',
      );
    } else {
      expect(selectedAction).toBeInTheDocument();
      editors.forEach((editor, index) =>
        expect(EditorView.findFromDOM(editor)!.state).toBe(states[index]),
      );
    }
  },
);

it('da a cada CodeMirror su viewport sincronizado en archivos completos largos', async () => {
  const git = createMockGitPort({ latency: NO_LATENCY });
  const path = 'src/design/roles.css';
  const source = { kind: 'worktree' as const };
  const lines = Array.from({ length: 2_400 }, (_, index) => `línea ${String(index + 1)}`);
  vi.spyOn(git, 'readFile').mockResolvedValue({
    path,
    text: lines.join('\n'),
    binary: false,
    size: lines.join('\n').length,
    mediaType: 'text/css',
    encoding: 'UTF-8',
  });
  useWorkingStore.getState().setDiffOptions({ columns: 'split', scope: 'file', content: 'diff' });

  const { container } = render(
    <PortsContext value={{ ...selectPorts(), git }}>
      <I18nProvider initialLocale="es-MX">
        <DiffViewer
          repoId="gitthul"
          diff={{ path, source, returnTo: null }}
          actions={{} as WorkingActions}
          status={null}
          onClose={() => {}}
        />
      </I18nProvider>
    </PortsContext>,
  );

  const editors = await screen.findAllByRole('textbox');
  expect(editors).toHaveLength(2);
  expect(editors.map((editor) => EditorView.findFromDOM(editor)!.state.doc.lines)).toEqual([
    2_400, 2_400,
  ]);
  expect(container.querySelectorAll(`.${styles.ownedPane}`)).toHaveLength(2);
  expect(container.querySelectorAll(`.${styles.horizontalPane}`)).toHaveLength(0);

  const scrollers = Array.from(container.querySelectorAll<HTMLElement>('.cm-scroller'));
  expect(scrollers).toHaveLength(2);
  scrollers[0]!.scrollTop = 9_000;
  fireEvent.scroll(scrollers[0]!);
  expect(scrollers[1]!.scrollTop).toBe(9_000);
});

it('muestra un archivo borrado en una sola columna sin intentar leerlo del árbol nuevo', async () => {
  const git = createMockGitPort({ latency: NO_LATENCY });
  const path = 'borrado.txt';
  const source = { kind: 'commit' as const, sha: 'abc123' };
  const base = await git.readDiff('gitthul', {
    path: 'src/design/roles.css',
    source: { kind: 'worktree' },
  });
  if (base.content.kind !== 'text') throw new Error('El fixture debe ser textual');
  vi.spyOn(git, 'readDiff').mockResolvedValue({
    ...base,
    path,
    source,
    change: 'deleted',
    content: {
      ...base.content,
      hunks: [
        {
          id: 'deleted',
          oldStart: 1,
          oldLines: 2,
          newStart: 0,
          newLines: 0,
          header: '',
          lines: [
            { kind: 'removed', oldLine: 1, newLine: null, text: 'primera' },
            { kind: 'removed', oldLine: 2, newLine: null, text: 'última' },
          ],
        },
      ],
    },
  });
  const readFile = vi.spyOn(git, 'readFile');
  useWorkingStore.getState().setDiffOptions({ columns: 'split', scope: 'file', content: 'diff' });

  render(
    <PortsContext value={{ ...selectPorts(), git }}>
      <I18nProvider initialLocale="es-MX">
        <DiffViewer
          repoId="gitthul"
          diff={{ path, source, returnTo: null }}
          actions={{} as WorkingActions}
          status={null}
          onClose={() => {}}
        />
      </I18nProvider>
    </PortsContext>,
  );

  const [editor] = await screen.findAllByRole('textbox');
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  const view = EditorView.findFromDOM(editor!)!;
  expect(view.state.doc.toString()).toBe('-primera\n-última');
  expect(readFile).not.toHaveBeenCalled();
});

it.each(['diff', 'file'] as const)(
  'lee el archivo de HEAD que no cambió en el commit, con contenido %s',
  async (content) => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const path = 'src/heredado.ts';
    const source = { kind: 'commit' as const, sha: 'head-sin-cambios-en-archivo' };
    vi.spyOn(git, 'readDiff').mockResolvedValue({
      path,
      source,
      change: 'unmodified',
      precondition: { before: null, after: null },
      content: { kind: 'text', hunks: [], truncated: false, encoding: 'UTF-8' },
    });
    const readFile = vi.spyOn(git, 'readFile').mockResolvedValue({
      path,
      text: 'export const heredado = 42;\n',
      binary: false,
      size: 28,
      mediaType: 'text/plain',
      encoding: 'UTF-8',
    });
    useWorkingStore.getState().setDiffOptions({ columns: 'split', scope: 'file', content });
    render(
      <PortsContext value={{ ...selectPorts(), git }}>
        <I18nProvider initialLocale="es-MX">
          <DiffViewer
            repoId="gitthul"
            diff={{ path, source, returnTo: null }}
            actions={{} as WorkingActions}
            status={null}
            onClose={() => {}}
          />
        </I18nProvider>
      </PortsContext>,
    );
    const editors = await screen.findAllByRole('textbox');
    expect(readFile.mock.calls[0]?.slice(0, 3)).toEqual(['gitthul', path, source.sha]);
    expect(readFile.mock.calls[0]?.[3]?.signal).toBeInstanceOf(AbortSignal);
    for (const editor of editors)
      expect(EditorView.findFromDOM(editor)!.state.doc.toString()).toContain(
        'export const heredado = 42;',
      );
  },
);

// The selected encoding must travel to byte reads in every visible mode.
it.each(['hunks', 'file'] as const)(
  'reloads diff and full contents after changing encoding (%s)',
  async (scope) => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const readDiff = vi.spyOn(git, 'readDiff');
    const readFile = vi.spyOn(git, 'readFile');
    useWorkingStore.getState().setDiffOptions({ scope, columns: 'unified' });
    const path = 'src/design/roles.css';
    render(
      <PortsContext value={{ ...selectPorts(), git }}>
        <I18nProvider initialLocale="es-MX">
          <DiffViewer
            repoId="gitthul"
            diff={{ path, source: { kind: 'worktree' }, returnTo: null }}
            actions={{} as WorkingActions}
            status={null}
            onClose={() => {}}
          />
        </I18nProvider>
      </PortsContext>,
    );
    await screen.findAllByRole('textbox');
    fireEvent.change(screen.getByRole('combobox', { name: 'Codificación' }), {
      target: { value: 'windows-1252' },
    });
    await waitFor(() =>
      expect(readDiff).toHaveBeenLastCalledWith(
        'gitthul',
        expect.objectContaining({ encoding: 'windows-1252' }),
        expect.anything(),
      ),
    );
    if (scope === 'file')
      await waitFor(() =>
        expect(readFile).toHaveBeenLastCalledWith(
          'gitthul',
          path,
          undefined,
          expect.objectContaining({ encoding: 'windows-1252' }),
        ),
      );
    await waitFor(() =>
      expect(document.querySelector('[data-encoding="windows-1252"]')).not.toBeNull(),
    );
  },
);

it.each([
  ['split', 'file', 'worktree', 30, 32],
  ['unified', 'file', 'worktree', 30, 34],
  ['split', 'hunks', 'worktree', 4, 6],
  ['unified', 'hunks', 'worktree', 4, 8],
  ['unified', 'hunks', 'commit', 6, 10],
] as const)(
  'centra el primer tramo modificado y conserva el scroll al refrescar (%s, %s, %s)',
  async (columns, scope, kind, from, to) => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const path = 'centrado.ts';
    const source = kind === 'commit' ? { kind, sha: 'abc123' } : { kind };
    const base = await git.readDiff('gitthul', {
      path: 'src/design/roles.css',
      source: { kind: 'worktree' },
    });
    if (base.content.kind !== 'text') throw new Error('El fixture debe ser textual');
    const file = {
      ...base,
      path,
      source,
      content: {
        ...base.content,
        hunks: [
          {
            id: 'first',
            oldStart: 27,
            oldLines: 8,
            newStart: 27,
            newLines: 9,
            header: '',
            lines: [
              ...[27, 28, 29].map((line) => ({
                kind: 'context' as const,
                text: `línea ${line}`,
                oldLine: line,
                newLine: line,
              })),
              ...[30, 31].map((line) => ({
                kind: 'removed' as const,
                text: `antes ${line}`,
                oldLine: line,
                newLine: null,
              })),
              ...[30, 31, 32].map((line) => ({
                kind: 'added' as const,
                text: `después ${line}`,
                oldLine: null,
                newLine: line,
              })),
              ...[33, 34, 35].map((line) => ({
                kind: 'context' as const,
                text: `línea ${line}`,
                oldLine: line - 1,
                newLine: line,
              })),
            ],
          },
        ],
      },
    };
    const readDiff = vi.spyOn(git, 'readDiff').mockResolvedValue(file);
    vi.spyOn(git, 'readFile').mockResolvedValue({
      path,
      text: Array.from({ length: 100 }, (_, i) => `línea ${i + 1}`).join('\n'),
      binary: false,
      size: 900,
      mediaType: 'text/plain',
      encoding: 'UTF-8',
    });
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    const scroll = vi.spyOn(EditorView, 'scrollIntoView');
    const diff = { path, source, returnTo: null };
    useWorkingStore.getState().setDiffOptions({ columns, scope, content: 'diff' });
    const status = await git.readStatus('gitthul');
    const app = (snapshot: typeof status) => (
      <PortsContext value={{ ...selectPorts(), git }}>
        <I18nProvider initialLocale="es-MX">
          <DiffViewer
            repoId="gitthul"
            diff={diff}
            actions={{} as WorkingActions}
            status={snapshot}
            onClose={() => {}}
          />
        </I18nProvider>
      </PortsContext>
    );
    try {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get: () => 400,
      });
      const { container, rerender } = render(app(status));
      const editors = await screen.findAllByRole('textbox');
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
      const [range, options] = scroll.mock.calls[0]!;
      expect(options?.y).toBe('center');
      expect(range).toBeInstanceOf(SelectionRange);
      if (!(range instanceof SelectionRange)) throw new Error('Debe centrar el bloque completo');
      const doc = EditorView.findFromDOM(editors[0]!)!.state.doc;
      expect(doc.lineAt(range.head).number).toBe(from);
      expect(doc.lineAt(range.anchor).number).toBe(to);
      expect(range.head).toBeLessThan(range.anchor);
      expect(doc.lineAt(range.head).text).toContain('antes 30');
      expect(doc.lineAt(range.anchor).text).toBe(columns === 'split' ? '' : '+después 32');
      expect(EditorView.findFromDOM(editors[0]!)!.state.selection.main.empty).toBe(true);
      const scroller =
        columns === 'split' && scope === 'file'
          ? container.querySelector<HTMLElement>('.cm-scroller')!
          : container.querySelector<HTMLElement>(`.${styles.scroll}`)!;
      scroller.scrollTop = 180;
      fireEvent.scroll(scroller);
      rerender(app({ ...status }));
      if (kind === 'worktree') await waitFor(() => expect(readDiff).toHaveBeenCalledTimes(2));
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroller.scrollTop).toBe(180);
    } finally {
      scroll.mockRestore();
      if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  },
);

it.each([
  ['split', 'file', 'worktree'],
  ['unified', 'file', 'worktree'],
  ['split', 'hunks', 'worktree'],
  ['unified', 'hunks', 'worktree'],
  ['split', 'file', 'index'],
  ['unified', 'file', 'index'],
  ['split', 'hunks', 'index'],
  ['unified', 'hunks', 'index'],
] as const)('el botón del margen opera una línea (%s, %s, %s)', async (columns, scope, kind) => {
  const git = createMockGitPort({ latency: NO_LATENCY });
  const path = 'mixed.txt';
  const source = { kind };
  const fixture = await git.readDiff('gitthul', { path, source: { kind: 'worktree' } });
  const file = {
    ...fixture,
    change: 'modified' as const,
    source,
    content: {
      kind: 'text' as const,
      truncated: false,
      encoding: 'utf-8',
      hunks: [
        {
          id: 'one',
          oldStart: 1,
          oldLines: 4,
          newStart: 1,
          newLines: 4,
          header: '',
          lines: [
            { kind: 'context' as const, text: 'a', oldLine: 1, newLine: 1 },
            { kind: 'removed' as const, text: 'b', oldLine: 2, newLine: null },
            { kind: 'removed' as const, text: 'c', oldLine: 3, newLine: null },
            { kind: 'added' as const, text: 'B', oldLine: null, newLine: 2 },
            { kind: 'added' as const, text: 'C', oldLine: null, newLine: 3 },
            { kind: 'context' as const, text: 'd', oldLine: 4, newLine: 4 },
          ],
        },
      ],
    },
  };
  vi.spyOn(git, 'readDiff').mockResolvedValue(file);
  const readFile = vi.spyOn(git, 'readFile').mockResolvedValue({
    path,
    text: 'a\nB\nC\nd\n',
    binary: false,
    size: 8,
    mediaType: 'text/plain',
    encoding: 'utf-8',
  });
  useWorkingStore.getState().setDiffOptions({ columns, scope, content: 'diff' });
  const stageLines = vi.fn();
  const { container } = render(
    <PortsContext value={{ ...selectPorts(), git }}>
      <I18nProvider initialLocale="es-MX">
        <DiffViewer
          repoId="gitthul"
          diff={{ path, source, returnTo: null }}
          actions={{ stageLines } as unknown as WorkingActions}
          status={null}
          onClose={() => {}}
        />
      </I18nProvider>
    </PortsContext>,
  );
  await screen.findAllByRole('textbox');
  const editors = container.querySelectorAll('.cm-editor');
  const editor = editors[columns === 'split' ? 1 : 0]!;
  const buttons = editor.querySelectorAll<HTMLButtonElement>('.gitthul-line-choice');
  expect(buttons).toHaveLength(columns === 'split' ? 2 : 4);
  expect(container.querySelector('.gitthul-block-choice')).toBeNull();
  const button = buttons[columns === 'split' ? 0 : 2]!;
  expect(button.textContent).toBe(kind === 'worktree' ? '+' : '−');
  fireEvent.click(button);
  expect(stageLines).toHaveBeenCalledExactlyOnceWith(
    path,
    columns === 'split'
      ? [
          { side: 'old', line: 2 },
          { side: 'new', line: 2 },
        ]
      : [{ side: 'new', line: 2 }],
    kind === 'worktree' ? 'stage' : 'unstage',
    file.precondition,
    false,
  );
  act(() => useWorkingStore.setState({ pendingWrites: 1 }));
  expect(button).toBeDisabled();
  if (scope === 'file' && kind === 'index') {
    expect(readFile).toHaveBeenCalledWith(
      'gitthul',
      path,
      undefined,
      expect.objectContaining({ blob: file.precondition.after!.oid }),
    );
  }
});

it('el modo Archivo del stage muestra el blob preparado y conserva las líneas sin preparar en disco', async () => {
  const git = createMockGitPort({ latency: NO_LATENCY });
  const path = 'src/design/roles.css';
  const source = { kind: 'index' as const };
  const fixture = await git.readDiff('gitthul', { path, source: { kind: 'worktree' } });
  vi.spyOn(git, 'readDiff').mockResolvedValue({ ...fixture, source });
  const readFile = vi.spyOn(git, 'readFile').mockImplementation((_repo, filePath, _at, query) =>
    Promise.resolve({
      path: filePath,
      text: query?.blob ? 'only staged changes' : 'includes unstaged changes',
      binary: false,
      size: 20,
      mediaType: 'text/plain',
      encoding: 'utf-8',
    }),
  );
  useWorkingStore.getState().setDiffOptions({ content: 'file' });
  render(
    <PortsContext value={{ ...selectPorts(), git }}>
      <I18nProvider initialLocale="es-MX">
        <DiffViewer
          repoId="gitthul"
          diff={{ path, source, returnTo: null }}
          actions={{} as WorkingActions}
          status={null}
          onClose={() => {}}
        />
      </I18nProvider>
    </PortsContext>,
  );
  const editor = await screen.findByRole('textbox');
  expect(editor).toHaveTextContent('only staged changes');
  expect(editor).not.toHaveTextContent('includes unstaged changes');
  expect(readFile).toHaveBeenCalledWith(
    'gitthul',
    path,
    undefined,
    expect.objectContaining({ blob: fixture.precondition.after!.oid }),
  );
});

it.each(['added', 'deleted'] as const)(
  'el modo Archivo de un stash truncado lee el blob guardado del archivo %s',
  async (change) => {
    const git = createMockGitPort({ latency: NO_LATENCY });
    const path = 'nuevo.txt';
    const source = { kind: 'stash' as const, sha: 'saved-stash' };
    const snapshot = { oid: 'saved-blob', mode: '100644' as const };
    vi.spyOn(git, 'readDiff').mockResolvedValue({
      path,
      source,
      change,
      precondition: {
        before: change === 'deleted' ? snapshot : null,
        after: change === 'added' ? snapshot : null,
      },
      content: { kind: 'text', hunks: [], truncated: true, encoding: 'utf-8' },
    });
    const readFile = vi.spyOn(git, 'readFile').mockImplementation((_repo, filePath, _at, query) => {
      if (query?.blob !== snapshot.oid) {
        return Promise.reject(new Error('The tracked stash tree does not contain this file'));
      }
      return Promise.resolve({
        path: filePath,
        text: 'saved untracked contents\n',
        binary: false,
        size: 25,
        mediaType: 'text/plain',
        encoding: 'utf-8',
      });
    });
    useWorkingStore.getState().setDiffOptions({ content: 'file' });
    render(
      <PortsContext value={{ ...selectPorts(), git }}>
        <I18nProvider initialLocale="es-MX">
          <DiffViewer
            repoId="gitthul"
            diff={{ path, source, returnTo: null }}
            actions={{} as WorkingActions}
            status={null}
            onClose={() => {}}
          />
        </I18nProvider>
      </PortsContext>,
    );
    expect(await screen.findByRole('textbox')).toHaveTextContent('saved untracked contents');
    expect(readFile).toHaveBeenCalledWith(
      'gitthul',
      path,
      source.sha,
      expect.objectContaining({ blob: snapshot.oid }),
    );
    expect(screen.getByText('En el stash saved-s')).toBeInTheDocument();
  },
);
