import { describe, expect, it } from 'vitest';

import type { FileChange, TreeEntry } from '@core/domain/status';

import { mergeTreeWithChanges } from './staging';
import { revealFolderPath } from './useWorkingActions';

describe('mergeTreeWithChanges', () => {
  const tree: readonly TreeEntry[] = [
    { path: 'docs', kind: 'directory' },
    { path: 'docs/plan.md', kind: 'file' },
    { path: 'src', kind: 'directory' },
    { path: 'src/app', kind: 'directory' },
    { path: 'src/app/Shell.tsx', kind: 'file' },
    { path: 'src/app/tabs.ts', kind: 'file' },
    { path: 'src/design', kind: 'directory' },
    { path: 'src/design/roles.css', kind: 'file' },
  ];

  const change = (path: string, type: FileChange['change']): FileChange => ({
    path,
    change: type,
    binary: false,
    insertions: 5,
    deletions: 2,
  });

  it('marca como unmodified los archivos del árbol que no cambiaron', () => {
    const changes: readonly FileChange[] = [change('src/app/Shell.tsx', 'modified')];

    const result = mergeTreeWithChanges(tree, changes);

    const unmodified = result.filter((f) => f.change === 'unmodified');

    expect(unmodified.map((f) => f.path).sort()).toEqual([
      'docs/plan.md',
      'src/app/tabs.ts',
      'src/design/roles.css',
    ]);
  });

  it('conserva el tipo de cambio de los archivos que sí cambiaron', () => {
    const changes: readonly FileChange[] = [
      change('src/app/Shell.tsx', 'modified'),
      change('src/design/roles.css', 'added'),
    ];

    const result = mergeTreeWithChanges(tree, changes);
    const shell = result.find((f) => f.path === 'src/app/Shell.tsx');
    const roles = result.find((f) => f.path === 'src/design/roles.css');

    expect(shell?.change).toBe('modified');
    expect(roles?.change).toBe('added');
  });

  it('ignora las entradas de tipo directorio', () => {
    const changes: readonly FileChange[] = [];
    const result = mergeTreeWithChanges(tree, changes);

    // Solo archivos, ningún directorio.
    expect(result.every((f) => !f.path.endsWith('/'))).toBe(true);
    expect(result.find((f) => f.path === 'docs')).toBeUndefined();
    expect(result.find((f) => f.path === 'src')).toBeUndefined();
  });

  it('incluye archivos que están en changes pero no en el árbol', () => {
    const changes: readonly FileChange[] = [change('new-file.ts', 'untracked')];

    const result = mergeTreeWithChanges(tree, changes);
    const newFile = result.find((f) => f.path === 'new-file.ts');

    expect(newFile?.change).toBe('untracked');
  });

  it('con un árbol vacío devuelve los mismos cambios', () => {
    const changes: readonly FileChange[] = [
      change('src/app/Shell.tsx', 'modified'),
      change('src/design/roles.css', 'deleted'),
    ];

    const result = mergeTreeWithChanges([], changes);

    expect(result).toEqual(changes);
  });

  it('los archivos unmodified tienen cero inserciones y borrados', () => {
    const changes: readonly FileChange[] = [];
    const result = mergeTreeWithChanges(tree, changes);

    for (const file of result) {
      expect(file.insertions).toBe(0);
      expect(file.deletions).toBe(0);
      expect(file.binary).toBe(false);
    }
  });
});

describe('revealFolderPath', () => {
  it('abre la carpeta contenedora con una ruta absoluta', () => {
    expect(revealFolderPath('/repo', 'src/app.ts')).toBe('/repo/src');
  });

  it('abre la propia carpeta y conserva la raíz para archivos de primer nivel', () => {
    expect(revealFolderPath('/repo/', 'src/design/')).toBe('/repo/src/design');
    expect(revealFolderPath('/repo/', 'README.md')).toBe('/repo');
  });
});
