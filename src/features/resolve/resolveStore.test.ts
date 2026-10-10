import { beforeEach, describe, expect, it } from 'vitest';

import { useResolveStore } from './resolveStore';

beforeEach(() => {
  useResolveStore.getState().unload();
  useResolveStore.getState().openFile('src/app.ts');
  useResolveStore.getState().setBlockIds(['c1']);
});

describe('selecciones granulares de Resolver', () => {
  it('añade líneas sin duplicarlas y sustituye la selección por el lado completo', () => {
    const selection = [{ blockId: 'c1', choices: ['ours:0', 'ours:2'] as const }];

    useResolveStore.getState().addLines('ours', selection);
    useResolveStore.getState().addLines('ours', selection);

    expect(useResolveStore.getState().choices.get('c1')).toEqual(['ours:0', 'ours:2']);

    useResolveStore.getState().take('ours');

    expect(useResolveStore.getState().choices.get('c1')).toEqual(['ours']);
  });

  it('agregar una línea reemplaza una decisión previa de dejar el bloque vacío', () => {
    useResolveStore.getState().take('none');
    useResolveStore.getState().addLines('theirs', [{ blockId: 'c1', choices: ['theirs:1'] }]);

    expect(useResolveStore.getState().choices.get('c1')).toEqual(['theirs:1']);
  });

  it('las casillas alternan una línea, un bloque y el lado completo', () => {
    useResolveStore.getState().setBlockIds(['c1', 'c2']);

    useResolveStore.getState().setLine('ours', 'c1', 1, true, 3);
    expect(useResolveStore.getState().choices.get('c1')).toEqual(['ours:1']);

    useResolveStore.getState().setBlockSide('ours', 'c1', true);
    expect(useResolveStore.getState().choices.get('c1')).toEqual(['ours']);

    // Quitar una sola línea de un bloque completo conserva las demás.
    useResolveStore.getState().setLine('ours', 'c1', 1, false, 3);
    expect(useResolveStore.getState().choices.get('c1')).toEqual(['ours:0', 'ours:2']);

    useResolveStore.getState().setAllSide('theirs', true);
    expect(useResolveStore.getState().choices.get('c1')).toContain('theirs');
    expect(useResolveStore.getState().choices.get('c2')).toEqual(['theirs']);

    useResolveStore.getState().setAllSide('theirs', false);
    expect(useResolveStore.getState().choices.get('c2')).toBeUndefined();
  });
});

it('conserva el texto manual al elegir ambos lados sin navegar', () => {
  const store = useResolveStore.getState();
  store.setBlockIds(['c1', 'c2']);
  store.setBlockText('c2', 'mi solución');
  store.setBlockSide('ours', 'c2', true);
  store.setBlockSide('theirs', 'c2', true);
  expect(useResolveStore.getState().blockText.get('c2')).toEqual({
    text: 'mi solución',
    resolved: true,
  });
  expect(useResolveStore.getState().choices.get('c2')).toEqual(['ours', 'theirs']);
  expect(useResolveStore.getState().blockIndex).toBe(0);
});

it('no conserva una línea provisional si se elige A antes de escribir', () => {
  const store = useResolveStore.getState();
  store.setBlockText('c1', '', false);
  store.setBlockSide('ours', 'c1', true);
  expect(useResolveStore.getState().blockText.has('c1')).toBe(false);
});

it('conserva las ramas del resultado al prepararlo y las limpia con el borrador', () => {
  const store = useResolveStore.getState();
  store.setDraft('src/app.ts', 'resuelto', ['ours'], { ours: 'main', theirs: 'feature' });
  expect(useResolveStore.getState().resolutionSources.get('src/app.ts')).toEqual({
    ours: 'main',
    theirs: 'feature',
  });
  store.clearDraft('src/app.ts');
  expect(useResolveStore.getState().resolutionSources.has('src/app.ts')).toBe(false);
});

it('reinicia la resolución con otra codificación y conserva los borradores de otros archivos', () => {
  const store = useResolveStore.getState();
  store.take('ours');
  store.setBlockText('c1', 'editado');
  store.setManual('src/app.ts', 'manual');
  store.setManual('otro.txt', 'otro borrador');
  store.restartWithEncoding('src/app.ts', 'windows-1255');
  const state = useResolveStore.getState();
  expect(state.encodings.get('src/app.ts')).toBe('windows-1255');
  expect(state.choices.size).toBe(0);
  expect(state.blockText.size).toBe(0);
  expect(state.manual.has('src/app.ts')).toBe(false);
  expect(state.manual.get('otro.txt')).toBe('otro borrador');
  expect(state.blockIds).toEqual([]);
  expect(state.blockIndex).toBe(0);
});
