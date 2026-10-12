import { beforeEach, expect, it } from 'vitest';
import type { DiffSource } from '@core/domain/diff';
import { useWorkingStore } from './workingStore';

beforeEach(() => useWorkingStore.getState().reset());

it.each(['\n', '\r\n', '\r'])(
  'retira el terminador %j del resumen cargado para amend',
  (ending) => {
    useWorkingStore.getState().setCommitDraft({
      summary: `Resumen existente${ending}`,
      body: 'Descripción\ncon dos líneas.',
      amend: true,
    });

    expect(useWorkingStore.getState().commitDraft).toMatchObject({
      summary: 'Resumen existente',
      body: 'Descripción\ncon dos líneas.',
      amend: true,
    });
  },
);

it('mantiene el resumen en una línea al actualizar y restaurar borradores', () => {
  const store = useWorkingStore.getState();
  store.setCommitDraft({ summary: 'Una\r\nsegunda\rtercera\nlínea\n' });
  store.setCommitDraft({ body: 'Detalle intacto\nsegunda línea.' });

  expect(useWorkingStore.getState().commitDraft.summary).toBe('Una segunda tercera línea');

  store.setCommitDraft({ summary: 'Borrador\nrestaurado', amend: false });
  expect(useWorkingStore.getState().commitDraft).toMatchObject({
    summary: 'Borrador restaurado',
    body: 'Detalle intacto\nsegunda línea.',
    amend: false,
  });
});

it.each([false, true])(
  'recorta los campos del borrador con amend=%j a 72 y 4500 caracteres',
  (amend) => {
    const store = useWorkingStore.getState();
    const longBody = 'Detalle\n'.repeat(600);
    store.setCommitDraft({
      summary: `${'s'.repeat(70)}\r\nfinal`,
      body: longBody,
      amend,
    });

    expect(useWorkingStore.getState().commitDraft).toMatchObject({
      summary: `${'s'.repeat(70)} f`,
      body: longBody.slice(0, 4500),
      amend,
    });

    store.setCommitDraft({ summary: 'r'.repeat(73) });
    expect(useWorkingStore.getState().commitDraft.summary).toBe('r'.repeat(72));
    expect(useWorkingStore.getState().commitDraft.body).toBe(longBody.slice(0, 4500));

    store.setCommitDraft({ body: 'd'.repeat(4501) });
    expect(useWorkingStore.getState().commitDraft.summary).toBe('r'.repeat(72));
    expect(useWorkingStore.getState().commitDraft.body).toBe('d'.repeat(4500));
  },
);

it('abre por defecto el diff en dos columnas y archivo completo', () => {
  expect(useWorkingStore.getState().diffOptions).toMatchObject({
    columns: 'split',
    scope: 'file',
    content: 'diff',
  });
});
it('marca la versión abierta del historial y lo cierra al seleccionar otro commit', () => {
  const store = useWorkingStore.getState();
  store.setSelectedCommits(new Set(['origin']));
  store.openFileHistory('file.txt', 'origin');
  store.openDiff({ path: 'file.txt', source: { kind: 'commit', sha: 'version' } });
  expect(useWorkingStore.getState().fileHistory?.at).toBe('version');
  store.closeDiff();
  expect(useWorkingStore.getState().fileHistory).not.toBeNull();
  store.setSelectedCommits(new Set(['other']));
  expect(useWorkingStore.getState().fileHistory).toBeNull();
  expect(useWorkingStore.getState().diff).toBeNull();
});

it.each<[DiffSource, string | undefined]>([
  [{ kind: 'worktree' }, undefined],
  [{ kind: 'index' }, undefined],
  [{ kind: 'commit', sha: 'version' }, 'version'],
  [{ kind: 'range', from: 'old', to: 'new' }, 'new'],
  [{ kind: 'workingRange', from: 'base' }, undefined],
])('abre el historial sin reemplazar el diff %j', (source, at) => {
  const store = useWorkingStore.getState();
  store.setSelectedCommits(new Set(['selected']));
  store.setDetailsCollapsed(true);
  store.openDiff({ path: 'file.txt', source });

  store.toggleDiffFileHistory();

  expect(useWorkingStore.getState().fileHistory).toEqual({
    path: 'file.txt',
    ...(at === undefined ? {} : { at }),
  });
  expect(useWorkingStore.getState().diff).toEqual({ path: 'file.txt', source, returnTo: null });
  expect(useWorkingStore.getState().detailsCollapsed).toBe(false);

  store.closeDiff();
  expect(useWorkingStore.getState().fileHistory?.path).toBe('file.txt');
  expect(useWorkingStore.getState().goTo).toBeNull();
});

it('el segundo clic cierra solo el historial y abrir otro archivo reemplaza su historial', () => {
  const store = useWorkingStore.getState();
  store.openDiff({ path: 'first.txt', source: { kind: 'worktree' } });
  store.toggleDiffFileHistory();
  store.toggleDiffFileHistory();
  expect(useWorkingStore.getState().fileHistory).toBeNull();
  expect(useWorkingStore.getState().diff?.path).toBe('first.txt');

  store.toggleDiffFileHistory();
  store.openDiff({ path: 'second.txt', source: { kind: 'commit', sha: 'version' } });
  store.toggleDiffFileHistory();
  expect(useWorkingStore.getState().fileHistory).toEqual({ path: 'second.txt', at: 'version' });
  expect(useWorkingStore.getState().diff?.path).toBe('second.txt');
});
